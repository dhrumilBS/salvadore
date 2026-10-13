/* ══════════════════════════ Command palette + post finder ══════════════════════════
 * Ctrl/Cmd+K anywhere (or the top-bar "Search posts…" pill): one input that
 * searches this site's posts (title / slug / ID / full URL or path - server side,
 * api/finder_search.php), jumps to a tab, or runs an action. Opening a post shows
 * the post detail drawer (api/finder_post.php): permalink + live status, SEO
 * fields, links in content, redirect conflicts, revisions, menu order - and
 * hand-offs into the tabs that can change those things. Read-only: nothing here
 * ever writes.
 *
 * Globals: bindFinder(), openFinder(initialQuery?), closeFinder(), isFinderOpen(),
 * finderHandleKey(e) -> true when the key was handled (call it first in the global
 * keydown handler; while the palette or drawer is open it takes every key, and it
 * does its own preventDefault - so never preventDefault on its behalf, or typing breaks).
 * Recent posts: localStorage "md.finder.recent.<SITE>" (max 8).
 */
(function () {
    'use strict';

    const MAX_RECENT = 8;
    const SEARCH_DEBOUNCE = 160;
    const DETAIL_TTL = 60 * 1000;
    const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

    /* Tabs offered under "Go to" - filtered at runtime by what VIEWS actually has. */
    const TABS = [
        { key: 'overview',  label: 'Overview',        words: 'home dashboard summary',               g: '' },
        { key: 'content',   label: 'Content',         words: 'posts pages list edit status meta',    g: 'g c' },
        { key: 'links',     label: 'Links & UTM',     words: 'links utm tracking domains checker',   g: 'g l' },
        { key: 'fixer',     label: 'Link Fixer',      words: 'broken links fix unlink edit href',    g: 'g f' },
        { key: 'redirects', label: 'Redirects',       words: 'yoast 301 410 redirect rules',         g: 'g r' },
        { key: 'bulk',      label: 'Bulk URL Update', words: 'bulk urls slugs status trash',         g: 'g b' },
        { key: 'menu',      label: 'Menu Order',      words: 'order reorder drag menu_order',        g: 'g m' },
        { key: 'replace',   label: 'Find & Replace',  words: 'find replace text search',             g: 'g s' },
        { key: 'keywords',  label: 'Focus Keywords',  words: 'yoast focus keyword duplicates seo',   g: 'g k' },
    ];

    const ICONS = {
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
        doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>',
        bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
        ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    };

    /* Markup is injected by bindFinder() when the page doesn't already have it
     * (_snippets/finder.html holds the same markup for pasting into index.html). */
    const PALETTE_HTML = `
<div class="fd-overlay" id="fd-palette" hidden>
    <div class="fd-palette" role="dialog" aria-modal="true" aria-label="Search posts, tabs and actions">
        <div class="fd-inputrow">
            <span class="fd-inputicon" aria-hidden="true">${ICONS.search}</span>
            <input id="fd-input" type="text" role="combobox" aria-expanded="true" aria-controls="fd-list" aria-autocomplete="list"
                autocomplete="off" spellcheck="false" placeholder="Search posts by title, slug, ID or URL — or jump to a tab…">
            <span class="fd-spin" id="fd-spin" hidden></span>
            <kbd class="fd-kbd fd-esc">Esc</kbd>
        </div>
        <div class="fd-list" id="fd-list" role="listbox" aria-label="Results"></div>
        <div class="fd-foot">
            <span><kbd class="fd-kbd">↑</kbd><kbd class="fd-kbd">↓</kbd> move</span>
            <span><kbd class="fd-kbd">Enter</kbd> open</span>
            <span><kbd class="fd-kbd">Tab</kbd> next section</span>
            <span class="fd-foot-site" id="fd-site"></span>
        </div>
    </div>
</div>`;

    const DRAWER_HTML = `
<div class="fd-scrim" id="fd-scrim" hidden></div>
<aside class="fd-drawer" id="fd-drawer" role="dialog" aria-modal="true" aria-labelledby="fd-d-title" hidden>
    <header class="fd-d-head">
        <button type="button" class="fd-iconbtn" id="fd-d-back" title="Back" aria-label="Back" hidden></button>
        <div class="fd-d-titlewrap">
            <div class="fd-d-kicker" id="fd-d-kicker"></div>
            <h2 class="fd-d-title" id="fd-d-title"></h2>
        </div>
        <button type="button" class="fd-iconbtn" id="fd-d-close" title="Close (Esc)" aria-label="Close">×</button>
    </header>
    <div class="fd-d-body" id="fd-d-body"></div>
</aside>`;

    /* ── state ── */
    let els = null;
    let paletteOpen = false;
    let drawerOpen = false;
    let returnFocus = null;
    let drawerReturnFocus = null;

    let query = '';
    let flat = [];          // every selectable item, in display order
    let sectionStarts = []; // index into flat where each section begins
    let active = 0;
    let userMoved = false;  // keep the user's selection when late post results arrive

    const searchCache = new Map(); // site|q -> rows
    let posts = { q: '', state: 'idle', rows: [], msg: '' };
    let searchCtrl = null;
    let searchTimer = null;
    let prefetchTimer = null;

    const detailCache = new Map(); // site|id -> { t, promise }
    let drawerStack = [];          // post IDs, for Back
    let drawerToken = 0;
    let current = null;            // the detail JSON on screen
    let linkFilter = 'all';

    const $ = id => document.getElementById(id);
    const site = () => (typeof SITE === 'string' && SITE) ? SITE : 'default';
    const recentKey = () => 'md.finder.recent.' + site();

    /* ══════════════════════════ Recent posts ══════════════════════════ */
    function readRecent() {
        try {
            const v = JSON.parse(localStorage.getItem(recentKey()) || '[]');
            return Array.isArray(v) ? v.filter(r => r && r.id).slice(0, MAX_RECENT) : [];
        } catch (e) { return []; }
    }
    function writeRecent(list) {
        try { localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, MAX_RECENT))); } catch (e) { /* storage blocked */ }
    }
    function pushRecent(p) {
        const entry = { id: p.id, title_text: p.title_text || p.title || '', post_type: p.post_type, status: p.status, path: p.path || '', permalink: p.permalink || '' };
        writeRecent([entry, ...readRecent().filter(r => r.id !== p.id)]);
    }

    /* ══════════════════════════ Helpers ══════════════════════════ */
    const esc = s => escapeHtml(s);
    const plural = (n, w) => `${Number(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
    const charLen = s => [...String(s || '')].length;
    const tLabel = t => (typeof typeLabel === 'function' ? typeLabel(t) : String(t || ''));

    /** Escape `text` and wrap every case-insensitive occurrence of the query's words in <mark>. */
    function hl(text, q) {
        text = String(text ?? '');
        const words = String(q || '').trim().split(/\s+/).filter(w => w.length > 0).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!words.length) return esc(text);
        const re = new RegExp('(' + words.join('|') + ')', 'ig');
        return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
    }

    function fmtDate(s) {
        if (!s || s.startsWith('0000')) return '—';
        const d = new Date(s.replace(' ', 'T'));
        if (isNaN(d)) return esc(s);
        const days = Math.round((Date.now() - d.getTime()) / 86400000);
        const rel = days === 0 ? 'today' : days === 1 ? 'yesterday' : days > 0 ? (days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} years ago`) : `in ${-days} days`;
        return `${esc(s.slice(0, 16))} <span class="fd-muted">· ${rel}</span>`;
    }

    const pathLabel = p => (p.path ? '/' + p.path + '/' : '/');
    const hasView = key => typeof VIEWS === 'object' && VIEWS && !!VIEWS[key];

    /** Navigate to a tab route by hash; re-dispatches hashchange when the hash is already that value. */
    function goHash(hash) {
        if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash = hash;
    }

    function findInFixer(text) {
        // Link Fixer only re-reads its filters when it (re)loads - force one, or an already
        // loaded Fixer would show the new "find" text in the box but keep its old rows.
        if (typeof viewNeedsLoad === 'object' && viewNeedsLoad) viewNeedsLoad.fixer = true;
        goHash('#fixer?find=' + encodeURIComponent(text));
    }
    const findReplace = text => goHash('#replace?find=' + encodeURIComponent(text));

    function setInput(id, value) {
        const input = $(id);
        if (!input) return false;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    /* ══════════════════════════ Palette: items ══════════════════════════ */
    function postItem(p, kind) {
        return {
            kind: 'post',
            key: 'p' + p.id,
            id: p.id,
            data: p,
            html: () => `
                <span class="fd-ico" aria-hidden="true">${kind === 'recent' ? ICONS.clock : ICONS.doc}</span>
                <span class="fd-main">
                    <span class="fd-label">${hl(p.title_text || '(no title)', kind === 'recent' ? '' : query)}</span>
                    <span class="fd-sub fd-mono">${hl(pathLabel(p), kind === 'recent' ? '' : query)}</span>
                </span>
                <span class="fd-meta">
                    ${p.match === 'id' ? '<span class="fd-pill fd-pill-accent">ID match</span>' : ''}
                    ${p.match === 'path' ? '<span class="fd-pill fd-pill-accent">URL match</span>' : ''}
                    <span class="fd-pill">${esc(tLabel(p.post_type))}</span>
                    ${statusBadge(p.status || '')}
                    <span class="fd-id">#${esc(p.id)}</span>
                </span>`,
            run: () => { closeFinder({ restoreFocus: false }); openPost(p.id, p); },
            alt: () => { if (p.permalink) window.open(p.permalink, '_blank', 'noopener'); },
        };
    }

    function tabItems(q) {
        const ql = q.toLowerCase();
        return TABS.filter(t => hasView(t.key)).filter(t => {
            if (!ql) return true;
            const label = t.label.toLowerCase();
            const initials = t.label.split(/[\s&]+/).filter(Boolean).map(w => w[0]).join('').toLowerCase();
            return label.includes(ql) || initials === ql || ql.split(/\s+/).every(w => (label + ' ' + t.words).includes(w));
        }).map(t => ({
            kind: 'tab',
            key: 't' + t.key,
            html: () => `
                <span class="fd-ico" aria-hidden="true">${ICONS.tab}</span>
                <span class="fd-main"><span class="fd-label">${hl(t.label, q)}</span><span class="fd-sub">Go to tab${typeof activeView === 'string' && activeView === t.key ? ' · current' : ''}</span></span>
                <span class="fd-meta">${t.g ? t.g.split(' ').map(k => `<kbd class="fd-kbd">${k}</kbd>`).join('') : ''}</span>`,
            run: () => { closeFinder({ restoreFocus: false }); showView(t.key); },
        }));
    }

    function actionItems(q) {
        const ql = q.toLowerCase();
        const list = [];
        const add = (label, sub, words, run, always = false) => {
            if (always || !ql || (label + ' ' + words).toLowerCase().includes(ql)) {
                list.push({
                    kind: 'action',
                    key: 'a' + label,
                    html: () => `
                        <span class="fd-ico" aria-hidden="true">${ICONS.bolt}</span>
                        <span class="fd-main"><span class="fd-label">${always ? esc(label) : hl(label, q)}</span><span class="fd-sub">${esc(sub)}</span></span>`,
                    run: () => { closeFinder({ restoreFocus: false }); run(); },
                });
            }
        };
        if (q) {
            add(`Find “${q}” in Link Fixer`, 'Posts whose links contain this text, site-wide', '', () => findInFixer(q), true);
            add(`Find & replace “${q}”`, 'Preview every match first — nothing is replaced until you confirm', '', () => findReplace(q), true);
        }
        add('Toggle theme', 'Switch between light and dark', 'dark light mode', () => $('themeToggle')?.click());
        if (typeof openHistory === 'function') add('Open link history', 'Link Fixer changes on this site, with undo', 'journal undo changes', () => openHistory());
        if (typeof openHelp === 'function') add('Keyboard shortcuts', 'Every shortcut on this page', 'help keys hotkeys', () => openHelp());
        if (!q && readRecent().length) add('Clear recent posts', 'Forget the posts opened from here on this site', 'history', () => { writeRecent([]); toast('Recent posts cleared', 'ok'); });
        return list;
    }

    function buildSections() {
        const q = query.trim();
        const sections = [];
        if (!q) {
            const recent = readRecent();
            if (recent.length) sections.push({ title: 'Recent posts', items: recent.map(r => postItem(r, 'recent')) });
        } else {
            let note = '';
            if (posts.q !== q || posts.state === 'loading') note = '<span class="fd-spin fd-spin-inline"></span> Searching…';
            else if (posts.state === 'short') note = 'Type at least 2 characters (or a post ID)';
            else if (posts.state === 'error') note = esc(posts.msg || 'Search failed');
            else if (!posts.rows.length) note = 'No posts match';
            const items = (posts.q === q && posts.state === 'done') ? posts.rows.map(r => postItem(r, 'post')) : [];
            sections.push({ title: 'Posts', items, note, count: posts.q === q && posts.state === 'done' ? posts.rows.length : null });
        }
        const tabs = tabItems(q);
        if (tabs.length) sections.push({ title: 'Go to', items: tabs });
        const acts = actionItems(q);
        if (acts.length) sections.push({ title: 'Actions', items: acts });
        return sections;
    }

    function renderList() {
        if (!els) return;
        const sections = buildSections();
        const prevItem = flat[active];
        flat = [];
        sectionStarts = [];
        let html = '';
        sections.forEach((s, si) => {
            if (s.items.length) sectionStarts.push(flat.length);
            html += `<div class="fd-sec" role="group" aria-labelledby="fd-sec-${si}">
                <div class="fd-sec-h" id="fd-sec-${si}">${esc(s.title)}${s.count != null ? ` <span class="fd-sec-n">${s.count}</span>` : ''}</div>`;
            if (s.note && !s.items.length) html += `<div class="fd-note">${s.note}</div>`;
            s.items.forEach(item => {
                const i = flat.length;
                flat.push(item);
                html += `<div class="fd-item" role="option" id="fd-opt-${i}" data-i="${i}" aria-selected="false">${item.html()}</div>`;
            });
            html += '</div>';
        });
        if (!flat.length && !sections.some(s => s.note)) html = '<div class="fd-empty">Nothing matches</div>';
        els.list.innerHTML = html;

        // Keep the user's place when results refresh under them; otherwise start at the top.
        if (userMoved && prevItem) {
            const same = flat.findIndex(it => it.key === prevItem.key);
            active = same >= 0 ? same : Math.min(active, Math.max(0, flat.length - 1));
        } else {
            active = 0;
        }
        paintActive(false);
    }

    function paintActive(scroll = true) {
        if (!els) return;
        els.list.querySelectorAll('.fd-item.is-active').forEach(el => { el.classList.remove('is-active'); el.setAttribute('aria-selected', 'false'); });
        const el = $('fd-opt-' + active);
        if (el && flat[active]) {
            el.classList.add('is-active');
            el.setAttribute('aria-selected', 'true');
            els.input.setAttribute('aria-activedescendant', el.id);
            if (scroll) el.scrollIntoView({ block: 'nearest' });
        } else {
            els.input.removeAttribute('aria-activedescendant');
        }
        schedulePrefetch();
    }

    function move(delta) {
        if (!flat.length) return;
        active = (active + delta + flat.length) % flat.length;
        userMoved = true;
        paintActive();
    }

    function jumpSection(dir) {
        if (!sectionStarts.length) return;
        let cur = 0;
        sectionStarts.forEach((start, i) => { if (active >= start) cur = i; });
        const next = (cur + dir + sectionStarts.length) % sectionStarts.length;
        active = sectionStarts[next];
        userMoved = true;
        paintActive();
    }

    /** Warm the detail cache for the highlighted post, so Enter opens it instantly. */
    function schedulePrefetch() {
        clearTimeout(prefetchTimer);
        const item = flat[active];
        if (!item || item.kind !== 'post') return;
        prefetchTimer = setTimeout(() => { if (paletteOpen && flat[active] === item) fetchDetail(item.id).catch(() => {}); }, 350);
    }

    /* ══════════════════════════ Palette: search ══════════════════════════ */
    function onQuery() {
        query = els.input.value;
        userMoved = false;
        const q = query.trim();
        clearTimeout(searchTimer);
        if (!q) { posts = { q: '', state: 'idle', rows: [] }; setSpin(false); renderList(); return; }

        const looksLikeId = /^\d+$/.test(q);
        if (q.length < 2 && !looksLikeId) {
            posts = { q, state: 'short', rows: [] };
            setSpin(false);
            renderList();
            return;
        }
        const key = site() + '|' + q.toLowerCase();
        if (searchCache.has(key)) {
            posts = { q, state: 'done', rows: searchCache.get(key) };
            setSpin(false);
            renderList();
            return;
        }
        // Show the "Searching…" row only if the old results aren't for a prefix of this query
        posts = { ...posts, state: 'loading' };
        renderList();
        searchTimer = setTimeout(() => runSearch(q, key), SEARCH_DEBOUNCE);
    }

    async function runSearch(q, key) {
        if (searchCtrl) searchCtrl.abort();
        searchCtrl = new AbortController();
        setSpin(true);
        try {
            const json = await api('finder_search.php', { params: { q }, signal: searchCtrl.signal });
            if (query.trim() !== q) return; // a newer query is already on its way
            if (!json || !json.success) {
                posts = { q, state: 'error', rows: [], msg: (json && json.msg) || 'Search failed' };
            } else {
                searchCache.set(key, json.data || []);
                if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
                posts = { q, state: 'done', rows: json.data || [] };
            }
        } catch (err) {
            if (isAbort(err)) return;
            console.error(err);
            posts = { q, state: 'error', rows: [], msg: 'Network error — search failed' };
        }
        setSpin(false);
        renderList();
    }

    function setSpin(on) { if (els) els.spin.hidden = !on; }

    /* ══════════════════════════ Palette: open / close ══════════════════════════ */
    function openFinder(initialQuery) {
        ensureMarkup();
        if (!paletteOpen) {
            returnFocus = document.activeElement;
            paletteOpen = true;
            els.palette.hidden = false;
            document.documentElement.classList.add('fd-lock');
            const label = (typeof siteList !== 'undefined' && Array.isArray(siteList) ? siteList.find(d => d.key === SITE)?.label : '') || '';
            els.site.textContent = label ? 'Site: ' + label : '';
        }
        if (typeof initialQuery === 'string') els.input.value = initialQuery;
        onQuery();
        els.input.focus();
        els.input.select();
    }

    function closeFinder({ restoreFocus = true } = {}) {
        if (!paletteOpen) return;
        paletteOpen = false;
        clearTimeout(searchTimer);
        clearTimeout(prefetchTimer);
        if (searchCtrl) searchCtrl.abort();
        setSpin(false);
        els.palette.hidden = true;
        if (!drawerOpen) document.documentElement.classList.remove('fd-lock');
        if (restoreFocus) {
            if (drawerOpen) $('fd-d-close')?.focus();
            else if (returnFocus && document.contains(returnFocus) && returnFocus.focus) returnFocus.focus();
        }
    }

    const isFinderOpen = () => paletteOpen || drawerOpen;

    /* ══════════════════════════ Keyboard ══════════════════════════ */
    function finderHandleKey(e) {
        const isK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key || '').toLowerCase() === 'k';

        if (paletteOpen) {
            if (isK) { e.preventDefault(); closeFinder(); return true; }
            switch (e.key) {
                case 'Escape': e.preventDefault(); closeFinder(); return true;
                case 'ArrowDown': e.preventDefault(); move(1); return true;
                case 'ArrowUp': e.preventDefault(); move(-1); return true;
                case 'Tab': e.preventDefault(); jumpSection(e.shiftKey ? -1 : 1); return true;
                case 'Enter': {
                    if (e.isComposing) return true;
                    e.preventDefault();
                    const item = flat[active];
                    if (!item) return true;
                    if ((e.ctrlKey || e.metaKey) && item.alt) item.alt();
                    else item.run();
                    return true;
                }
                case 'PageDown': e.preventDefault(); move(Math.min(5, flat.length - 1 - active) || 1); return true;
                case 'PageUp': e.preventDefault(); move(-Math.min(5, active) || -1); return true;
                default:
                    // Typing while focus wandered into the list goes back to the input.
                    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement !== els.input) els.input.focus();
                    return true; // swallow: no global shortcut fires under the palette
            }
        }

        if (drawerOpen) {
            if (isK) { e.preventDefault(); openFinder(''); return true; }
            if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return false;
            if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return true; }
            if (e.key === 'Backspace' && e.altKey && drawerStack.length > 1) { e.preventDefault(); drawerBack(); return true; }
            return true; // Tab, Enter on buttons, copy etc. work natively; global shortcuts stay quiet
        }

        if (isK) {
            if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return false;
            e.preventDefault();
            openFinder();
            return true;
        }
        return false;
    }

    /* ══════════════════════════ Drawer ══════════════════════════ */
    function fetchDetail(id) {
        const key = site() + '|' + id;
        const hit = detailCache.get(key);
        if (hit && Date.now() - hit.t < DETAIL_TTL) return hit.promise;
        const promise = api('finder_post.php', { params: { id } }).then(json => {
            if (!json || !json.success) {
                detailCache.delete(key);
                const err = new Error((json && json.msg) || 'Could not load this post');
                err.server = true;
                throw err;
            }
            return json;
        }, err => { detailCache.delete(key); throw err; });
        detailCache.set(key, { t: Date.now(), promise });
        if (detailCache.size > 40) detailCache.delete(detailCache.keys().next().value);
        return promise;
    }

    function openDrawerShell() {
        ensureMarkup();
        if (!drawerOpen) {
            const ae = document.activeElement;
            drawerReturnFocus = (!ae || ae === document.body || els.palette.contains(ae)) ? returnFocus : ae;
            drawerOpen = true;
            els.scrim.hidden = false;
            els.drawer.hidden = false;
            document.documentElement.classList.add('fd-lock');
            requestAnimationFrame(() => { els.drawer.classList.add('is-open'); els.scrim.classList.add('is-open'); });
        }
    }

    function closeDrawer() {
        if (!drawerOpen) return;
        drawerOpen = false;
        drawerToken++;
        drawerStack = [];
        current = null;
        els.drawer.classList.remove('is-open');
        els.scrim.classList.remove('is-open');
        setTimeout(() => { if (!drawerOpen) { els.drawer.hidden = true; els.scrim.hidden = true; } }, 200);
        if (!paletteOpen) document.documentElement.classList.remove('fd-lock');
        if (drawerReturnFocus && document.contains(drawerReturnFocus) && drawerReturnFocus.focus) drawerReturnFocus.focus();
    }

    /** Open (or switch the drawer to) one post. `seed` = a search/recent row, painted while the details load. */
    async function openPost(id, seed = null, { push = true } = {}) {
        id = Number(id);
        if (!id) return;
        openDrawerShell();
        if (push && drawerStack[drawerStack.length - 1] !== id) drawerStack.push(id);
        if (drawerStack.length > 20) drawerStack.shift();
        const token = ++drawerToken;
        linkFilter = 'all';
        renderHead(seed ? { ...seed, id } : { id, title_text: 'Loading…' });
        els.body.innerHTML = skeletonHtml();
        els.body.scrollTop = 0;
        $('fd-d-close').focus();
        if (seed) pushRecent({ ...seed, id });

        try {
            const json = await fetchDetail(id);
            if (token !== drawerToken) return;
            current = json;
            pushRecent(json.post);
            renderDetail(json);
        } catch (err) {
            if (token !== drawerToken) return;
            console.error(err);
            const msg = err.server ? err.message : 'Network error — could not load this post';
            els.body.innerHTML = `<div class="fd-error"><strong>${esc(msg)}</strong>
                <button type="button" class="btn" data-fd="retry">Retry</button></div>`;
        }
    }

    function drawerBack() {
        if (drawerStack.length < 2) return;
        drawerStack.pop();
        openPost(drawerStack[drawerStack.length - 1], null, { push: false });
    }

    function renderHead(p) {
        $('fd-d-kicker').innerHTML = [
            p.post_type ? `<span>${esc(tLabel(p.post_type))}</span>` : '',
            `<span class="fd-mono">#${esc(p.id)}</span>`,
            p.status ? statusBadge(p.status) : '',
        ].filter(Boolean).join('<span class="fd-dot">·</span>');
        $('fd-d-title').textContent = p.title_text || '(no title)';
        const back = $('fd-d-back');
        back.hidden = drawerStack.length < 2;
        back.innerHTML = ICONS.back;
    }

    function skeletonHtml() {
        return `<div class="fd-skel">${'<div class="fd-skel-card"><i></i><i></i><i class="short"></i></div>'.repeat(4)}</div>`;
    }

    /* ── detail sections ── */
    function card(title, body, { extra = '', tone = '', id = '' } = {}) {
        return `<section class="fd-card${tone ? ' fd-card-' + tone : ''}"${id ? ` id="${id}"` : ''}>
            <div class="fd-card-h"><h3>${title}</h3>${extra}</div>${body}</section>`;
    }

    function overviewHtml(d) {
        const p = d.post;
        const flags = [];
        if (p.is_front_page) flags.push('<span class="fd-pill fd-pill-accent">Front page</span>');
        if (p.is_posts_page) flags.push('<span class="fd-pill fd-pill-accent">Posts page</span>');
        if (p.has_password) flags.push('<span class="fd-pill fd-pill-warn">Password protected</span>');
        if (p.internal_type) flags.push('<span class="fd-pill fd-pill-warn">Internal post type</span>');
        if (p.slug_trashed) flags.push(`<span class="fd-pill fd-pill-warn" title="Stored slug: ${esc(p.slug)}">Slug still has “__trashed”</span>`);
        if (d.seo.noindex) flags.push('<span class="fd-pill fd-pill-danger">noindex</span>');

        const parent = p.parent
            ? (p.parent.missing
                ? `<span class="fd-warn-text">#${esc(p.parent.id)} (missing)</span>`
                : `<button type="button" class="fd-linkbtn" data-fd="open" data-id="${esc(p.parent.id)}">${esc(p.parent.title_text || '(no title)')}</button> <span class="fd-muted">#${esc(p.parent.id)} · ${esc(tLabel(p.parent.post_type))}</span> ${statusBadge(p.parent.status || '')}`)
            : '<span class="fd-muted">None (top level)</span>';

        const permalinkRow = `
            <div class="fd-permalink">
                <div class="fd-permalink-url">${urlCellHtml(p.permalink)}</div>
                <div class="fd-permalink-status">${LinkStatus.cell(p.permalink)}</div>
            </div>
            <div class="fd-btnrow">
                <a class="btn fd-btn" href="${esc(p.permalink)}" target="_blank" rel="noopener">${ICONS.ext} Open</a>
                <button type="button" class="btn fd-btn" data-fd="copy" data-copy-text="${esc(p.permalink)}">Copy URL</button>
                <a class="btn fd-btn" href="${esc(p.edit_url)}" target="_blank" rel="noopener">${ICONS.ext} Edit in WordPress</a>
            </div>`;

        const facts = [
            ['Published', fmtDate(p.post_date)],
            ['Modified', fmtDate(p.post_modified)],
            ['Author', p.author ? esc(p.author) : '<span class="fd-muted">—</span>'],
            ['Slug', `<span class="fd-mono">${esc(p.slug_clean || '—')}</span>`],
            ['Parent', parent],
            ['Menu order', `<span class="fd-mono">${esc(p.menu_order)}</span>${p.child_count ? ` <span class="fd-muted">· ${plural(p.child_count, 'child page')}</span>` : ''}`],
        ];
        if (p.categories.length) facts.push(['Categories', p.categories.map(esc).join(', ')]);
        if (p.tags.length) facts.push(['Tags', p.tags.map(esc).join(', ')]);

        return `<section class="fd-card">${permalinkRow}
            ${flags.length ? `<div class="fd-flags">${flags.join('')}</div>` : ''}
            <dl class="fd-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>`;
    }

    function counter(len, max) {
        const over = len > max;
        return `<span class="fd-count${over ? ' is-over' : ''}" title="${over ? `Over ${max} characters — likely truncated in search results` : `Up to ${max} characters is safe`}">${len} / ${max}</span>`;
    }

    function seoHtml(d) {
        const s = d.seo;
        const tLen = charLen(s.title), dLen = charLen(s.description);
        const varNote = '<div class="fd-hint">Contains Yoast variables (%%…%%) — the rendered length differs.</div>';

        const titleBlock = s.title
            ? `<div class="fd-seo-val">${esc(s.title)}</div>${s.title_has_vars ? varNote : ''}`
            : `<div class="fd-seo-val fd-warn-text">Not set — Yoast's title template is used</div>`;
        const descBlock = s.description
            ? `<div class="fd-seo-val">${esc(s.description)}</div>${s.desc_has_vars ? varNote : ''}`
            : `<div class="fd-seo-val fd-warn-text">Missing — search engines will pick their own snippet</div>`;

        let kwBlock;
        if (!s.focus_kw) {
            kwBlock = '<div class="fd-seo-val fd-muted">No focus keyword set</div>';
        } else {
            const n = s.kw_others.length;
            const others = n
                ? `<div class="fd-kw-dupes"><div class="fd-warn-text">Also used by ${s.kw_others_capped ? n + '+' : n} other post${n === 1 ? '' : 's'}</div>
                    <ul class="fd-mini-list">${s.kw_others.map(o => `<li>
                        <button type="button" class="fd-linkbtn" data-fd="open" data-id="${esc(o.id)}">${esc(o.title_text || '(no title)')}</button>
                        <span class="fd-muted">#${esc(o.id)} · ${esc(tLabel(o.post_type))}</span> ${statusBadge(o.status)}</li>`).join('')}</ul></div>`
                : '<div class="fd-ok-text">Not used by any other post</div>';
            kwBlock = `<div class="fd-seo-val"><span class="fd-kw">${esc(s.focus_kw)}</span></div>${others}`;
        }

        const canonical = s.canonical ? `<div class="fd-seo-row"><div class="fd-seo-k">Canonical</div>${urlCellHtml(s.canonical)}</div>` : '';
        const warnCount = (!s.title ? 1 : 0) + (tLen > 60 ? 1 : 0) + (!s.description ? 1 : 0) + (dLen > 160 ? 1 : 0) + (s.kw_others.length ? 1 : 0);

        return card('SEO', `
            <div class="fd-seo-row"><div class="fd-seo-k">Meta title ${s.title ? counter(tLen, 60) : ''}</div>${titleBlock}</div>
            <div class="fd-seo-row"><div class="fd-seo-k">Meta description ${s.description ? counter(dLen, 160) : ''}</div>${descBlock}</div>
            <div class="fd-seo-row"><div class="fd-seo-k">Focus keyword</div>${kwBlock}</div>
            ${canonical}
            ${s.focus_kw ? '<div class="fd-btnrow"><button type="button" class="btn fd-btn" data-fd="keywords">Open in Focus Keywords</button></div>' : ''}`,
            { extra: warnCount ? `<span class="fd-pill fd-pill-warn">${plural(warnCount, 'warning')}</span>` : '<span class="fd-pill fd-pill-ok">OK</span>' });
    }

    function linksHtml(d) {
        const L = d.links;
        if (!L.total) {
            return card('Links in content', `<div class="fd-empty-s">No links in this post's content.</div>
                <div class="fd-btnrow"><button type="button" class="btn fd-btn" data-fd="fixer-to">Find links to this post</button></div>
                <div class="fd-hint">“Find links to this post” opens Link Fixer's site-wide find with this permalink (inbound links).</div>`);
        }
        const seg = (key, label, n) => `<button type="button" class="fd-seg${linkFilter === key ? ' is-on' : ''}" data-fd="lfilter" data-v="${key}">${label} <b>${n}</b></button>`;
        return card('Links in content', `
            <div class="fd-links-bar">
                <div class="fd-segs">${seg('all', 'All', L.total)}${seg('int', 'Internal', L.internal)}${seg('ext', 'External', L.external)}</div>
                <button type="button" class="btn fd-btn" data-fd="checkall">Check all</button>
            </div>
            <div class="fd-links" id="fd-links">${linkRowsHtml(L.items)}</div>
            ${L.capped ? `<div class="fd-hint">Showing the first ${L.items.length} of ${L.total} links.</div>` : ''}
            <div class="fd-btnrow">
                <button type="button" class="btn fd-btn" data-fd="fixer-to">Find links to this post</button>
            </div>
            <div class="fd-hint">Link Fixer can't filter by post ID: “Find in Link Fixer” on a link shows every post using that URL (this one included); “Find links to this post” lists the posts that link here.</div>`,
            { extra: `<span class="fd-muted">${plural(L.total, 'link')}</span>` });
    }

    function linkRowsHtml(items) {
        const rows = items.filter(l => linkFilter === 'all' || (linkFilter === 'int' ? l.is_internal : !l.is_internal));
        if (!rows.length) return '<div class="fd-empty-s">No links of this kind.</div>';
        return rows.map(l => `
            <div class="fd-link">
                <div class="fd-link-top">
                    <span class="fd-link-anchor">${l.anchor ? esc(l.anchor) : '<span class="fd-muted">(no anchor text)</span>'}</span>
                    <span class="fd-pill${l.is_internal ? '' : ' fd-pill-accent'}">${l.is_internal ? 'internal' : 'external'}</span>
                    ${l.is_utm ? '<span class="badge badge-utm">UTM</span>' : ''}
                </div>
                <div class="fd-link-url">${urlCellHtml(l.url)}</div>
                <div class="fd-link-foot">
                    ${LinkStatus.cell(l.url)}
                    <button type="button" class="fd-linkbtn fd-small" data-fd="fixer-url" data-url="${esc(l.url)}">Find in Link Fixer</button>
                </div>
            </div>`).join('');
    }

    function ruleHtml(r, side) {
        const type = `<span class="fd-pill${r.type === 410 || r.type === 451 ? ' fd-pill-danger' : ''}">${esc(r.type)}</span>`;
        const fmt = r.format === 'regex' ? '<span class="fd-pill fd-pill-warn">regex</span>' : '';
        const dest = r.url ? `<span class="fd-mono">${esc(/^https?:/i.test(r.url) ? r.url : '/' + r.url + '/')}</span>` : '<span class="fd-muted">(gone — no destination)</span>';
        const origin = `<span class="fd-mono">${esc(r.format === 'regex' ? r.origin : '/' + r.origin + '/')}</span>`;
        return `<li class="fd-rule">
            <div class="fd-rule-line">${type}${fmt} ${side === 'to' ? origin + ' <span class="fd-arrow">→</span> <span class="fd-muted">this post</span>' : '<span class="fd-muted">this URL</span> <span class="fd-arrow">→</span> ' + dest}</div>
            ${side === 'to' && r.origin_url ? `<div class="fd-rule-check">${LinkStatus.cell(r.origin_url)}</div>` : ''}
        </li>`;
    }

    function redirectsHtml(d) {
        const R = d.redirects, p = d.post;
        const parts = [];
        if (R.from.length) {
            parts.push(p.is_live
                ? `<div class="fd-alert fd-alert-danger"><strong>Conflict:</strong> this post is ${esc(p.status)} but a redirect rule fires on its URL — visitors never reach it.</div>`
                : `<div class="fd-alert">This URL is retired by a redirect rule (the post is ${esc(p.status)}), which is the normal state for a removed post.</div>`);
            parts.push(`<div class="fd-sub-h">Rules on this URL</div><ul class="fd-rules">${R.from.map(r => ruleHtml(r, 'from')).join('')}</ul>`);
        }
        if (R.regex.length) {
            parts.push(`<div class="fd-sub-h">Regex rules that also match this path</div><ul class="fd-rules">${R.regex.map(r => ruleHtml(r, 'from')).join('')}</ul>`);
        }
        if (R.to.length) {
            parts.push(`<div class="fd-sub-h">Redirects pointing here</div><ul class="fd-rules">${R.to.map(r => ruleHtml(r, 'to')).join('')}</ul>`);
        }
        if (!parts.length) parts.push('<div class="fd-empty-s">No redirect rule fires on this URL or points to it.</div>');
        parts.push('<div class="fd-btnrow"><button type="button" class="btn fd-btn" data-fd="redirects">Open in Redirects</button></div>');

        const conflict = R.from.length && p.is_live;
        return card('Redirects', parts.join(''), {
            tone: conflict ? 'danger' : '',
            extra: conflict ? '<span class="fd-pill fd-pill-danger">Conflict</span>' : `<span class="fd-muted">${plural(R.from.length + R.to.length + R.regex.length, 'rule')}</span>`,
        });
    }

    function revisionsHtml(d) {
        const r = d.revisions;
        const url = `../version/?db=${encodeURIComponent(site())}&q=${encodeURIComponent(d.post.id)}`;
        return card('Revisions', `
            <div class="fd-rev">
                <div><span class="fd-big">${Number(r.count).toLocaleString()}</span> <span class="fd-muted">revision${r.count === 1 ? '' : 's'}${r.last ? ' · last ' + esc(String(r.last).slice(0, 16)) : ''}</span></div>
                <a class="btn fd-btn" href="${esc(url)}" target="_blank" rel="noopener">${ICONS.ext} Post revisions</a>
            </div>`);
    }

    function actionsHtml(d) {
        return card('Open in…', `
            <div class="fd-actions">
                <button type="button" class="btn fd-btn" data-fd="content">Content tab</button>
                ${d.seo.focus_kw ? '<button type="button" class="btn fd-btn" data-fd="keywords">Focus Keywords</button>' : ''}
                <button type="button" class="btn fd-btn" data-fd="replace-title">Find &amp; replace the title</button>
                <button type="button" class="btn fd-btn" data-fd="fixer-to">Link Fixer: links to this post</button>
                <button type="button" class="btn fd-btn" data-fd="redirects">Redirects tab</button>
            </div>
            <div class="fd-hint">Read-only view. Every change happens in the tab it opens, behind that tab's own confirm step.</div>`);
    }

    function renderDetail(d) {
        renderHead({ ...d.post });
        els.body.innerHTML = overviewHtml(d) + seoHtml(d) + linksHtml(d) + redirectsHtml(d) + revisionsHtml(d) + actionsHtml(d)
            + `<div class="fd-foot-note">Loaded in ${esc(d.server_ms)} ms · ${esc(d.home.replace(/^https?:\/\//, ''))}</div>`;
    }

    /* ── drawer actions ── */
    function goContent(p) {
        closeDrawer();
        showView('content');
        if (typeof hasUnsavedContentEdits === 'function' && hasUnsavedContentEdits()) {
            toast('Content tab has unsaved edits — filters left as they are', 'warn');
            return;
        }
        const sel = $('fStatus');
        if (sel && [...sel.options].some(o => o.value === p.status) && sel.value !== p.status) {
            sel.value = p.status;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const tab = [...document.querySelectorAll('#fPostTypeTabs .tab[data-type]')].find(b => b.dataset.type === p.post_type);
        if (tab && !tab.classList.contains('active')) tab.click();
        // Content search matches title / slug / content / Yoast fields - not the ID - so search by slug.
        setInput('fSearch', p.slug_clean || p.title_text || String(p.id));
    }

    function goKeywords(kw) {
        closeDrawer();
        showView('keywords');
        setTimeout(() => setInput('kw-search', kw), 0);
    }

    function goRedirects(p) {
        closeDrawer();
        showView('redirects');
        setInput('rSearch', p.path || p.slug_clean || '');
    }

    function onDrawerClick(e) {
        const el = e.target.closest('[data-fd]');
        if (!el || (!current && el.dataset.fd !== 'retry')) return;
        const p = current ? current.post : null;
        switch (el.dataset.fd) {
            case 'retry': {
                const id = drawerStack[drawerStack.length - 1];
                if (id) { detailCache.delete(site() + '|' + id); openPost(id, null, { push: false }); }
                return;
            }
            case 'open': openPost(el.dataset.id); return;
            case 'copy':
                copyToClipboard(el.dataset.copyText || '').then(ok => {
                    const idle = el.textContent;
                    el.textContent = ok ? 'Copied ✓' : 'Copy failed';
                    setTimeout(() => { el.textContent = idle; }, 1200);
                });
                return;
            case 'lfilter':
                linkFilter = el.dataset.v;
                els.body.querySelectorAll('.fd-seg').forEach(b => b.classList.toggle('is-on', b.dataset.v === linkFilter));
                $('fd-links').innerHTML = linkRowsHtml(current.links.items);
                return;
            case 'checkall':
                LinkStatus.checkManyWithButton(current.links.items.map(l => l.url), el);
                return;
            case 'fixer-url': closeDrawer(); findInFixer(el.dataset.url); return;
            case 'fixer-to': closeDrawer(); findInFixer(p.permalink.replace(/\/+$/, '')); return;
            case 'content': goContent(p); return;
            case 'keywords': goKeywords(current.seo.focus_kw); return;
            case 'redirects': goRedirects(p); return;
            case 'replace-title': closeDrawer(); findReplace(p.title); return;
        }
    }

    /* ══════════════════════════ Setup ══════════════════════════ */
    function ensureMarkup() {
        if (els) return;
        if (!$('fd-palette')) document.body.insertAdjacentHTML('beforeend', PALETTE_HTML);
        if (!$('fd-drawer')) document.body.insertAdjacentHTML('beforeend', DRAWER_HTML);
        els = {
            palette: $('fd-palette'),
            input: $('fd-input'),
            list: $('fd-list'),
            spin: $('fd-spin'),
            site: $('fd-site'),
            drawer: $('fd-drawer'),
            scrim: $('fd-scrim'),
            body: $('fd-d-body'),
        };

        els.input.addEventListener('input', onQuery);
        els.palette.addEventListener('mousedown', e => { if (e.target === els.palette) { e.preventDefault(); closeFinder(); } });
        els.list.addEventListener('mousemove', e => {
            const it = e.target.closest('.fd-item');
            if (!it) return;
            const i = Number(it.dataset.i);
            if (i !== active) { active = i; userMoved = true; paintActive(false); }
        });
        els.list.addEventListener('mousedown', e => { if (e.target.closest('.fd-item')) e.preventDefault(); }); // keep focus in the input
        els.list.addEventListener('click', e => {
            const it = e.target.closest('.fd-item');
            if (!it) return;
            const item = flat[Number(it.dataset.i)];
            if (!item) return;
            if ((e.ctrlKey || e.metaKey) && item.alt) item.alt();
            else item.run();
        });

        els.scrim.addEventListener('click', closeDrawer);
        $('fd-d-close').addEventListener('click', closeDrawer);
        $('fd-d-back').addEventListener('click', drawerBack);
        els.body.addEventListener('click', onDrawerClick);
    }

    function bindFinder() {
        ensureMarkup();
        const kbd = IS_MAC ? '⌘K' : 'Ctrl K';
        document.querySelectorAll('.fd-trigger-kbd').forEach(k => { k.textContent = kbd; });
        document.addEventListener('click', e => {
            const t = e.target.closest('#finderBtn, [data-finder-open]');
            if (!t) return;
            e.preventDefault();
            openFinder(t.dataset.finderOpen || undefined);
        });
    }

    window.bindFinder = bindFinder;
    window.openFinder = openFinder;
    window.closeFinder = closeFinder;
    window.isFinderOpen = isFinderOpen;
    window.finderHandleKey = finderHandleKey;
})();
