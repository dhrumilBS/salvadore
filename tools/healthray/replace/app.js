/* Find & Replace - page logic. Talks only to api/*.php; every call carries the
   site this page is pinned to (?db=), so two tabs on different sites never
   write into each other's database. */
(() => {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => Number(n).toLocaleString();
    const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
    const store = {
        get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    };

    const PAGE = 60;               // posts rendered per "Show more"
    const LIVE_SITES = ['landing', 'botphonic'];
    const SEO_NAMES = {
        _yoast_wpseo_title: 'SEO title', _yoast_wpseo_metadesc: 'Meta description', _yoast_wpseo_focuskw: 'Focus keyphrase',
        _yoast_wpseo_canonical: 'Canonical URL', '_yoast_wpseo_opengraph-title': 'Social title', '_yoast_wpseo_opengraph-description': 'Social description',
        '_yoast_wpseo_twitter-title': 'X title', '_yoast_wpseo_twitter-description': 'X description', _yoast_wpseo_bctitle: 'Breadcrumb title',
    };

    let site = new URLSearchParams(location.search).get('db') || store.get('fr.site', 'landing');
    let info = null;          // api/site.php for the current site
    let result = null;        // last search response
    let searched = null;      // options the shown results were found with
    let selected = new Set(); // field keys "kind:id"
    let done = new Set();     // field keys already replaced
    let viewScope = '';       // results filter: scope key or ''
    let viewText = '';
    let shown = PAGE;

    const key = f => `${f.kind}:${f.id}`;

    /* ───── API ───── */
    async function api(path, body) {
        const url = `api/${path}?db=${encodeURIComponent(site)}`;
        const opts = body === undefined ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Find-Replace': '1' },
            body: JSON.stringify({ ...body, db: site }),
        };
        let res, data;
        try {
            res = await fetch(url, opts);
            data = await res.json();
        } catch (e) {
            throw new Error(res ? `Server error (${res.status}). Check the database connection.` : 'Could not reach the server.');
        }
        if (!data.success) {
            const err = new Error(data.msg || 'Something went wrong.');
            err.data = data;
            throw err;
        }
        return data;
    }

    function toast(msg, type = '') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        $('toasts').append(t);
        setTimeout(() => t.remove(), type === 'err' ? 7000 : 4000);
    }

    /* ───── Site + form setup ───── */
    async function loadSite() {
        $('sites').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.key === site));
        try {
            info = await api('site.php');
        } catch (e) {
            // Keep the switcher usable so another site can still be picked.
            const sites = info?.sites || [{ key: 'landing', label: 'Landing - Live' }, { key: 'botphonic', label: 'Botphonic' }, { key: 'old', label: 'Old - Local' }];
            info = null;
            $('sites').innerHTML = sites.map(s => `<button type="button" role="radio" data-key="${esc(s.key)}" aria-checked="${s.key === site}">${esc(s.label)}</button>`).join('');
            $('results').innerHTML = `<div class="empty-state"><div class="big">🔌</div><h2>Can't connect to this site's database</h2><p>${esc(e.message)} Pick another site above, or check <code>tools/healthray/.env</code>.</p></div>`;
            return;
        }
        site = info.current;
        store.set('fr.site', site);
        history.replaceState(null, '', `?db=${encodeURIComponent(site)}`);
        document.title = `Find & Replace · ${info.label}`;
        renderSites();
        renderFilters();
    }

    function renderSites() {
        $('sites').innerHTML = info.sites.map(s =>
            `<button type="button" role="radio" data-key="${esc(s.key)}" aria-checked="${s.key === site}">${esc(s.label)}${LIVE_SITES.includes(s.key) ? ' <span class="live">LIVE</span>' : ''}</button>`).join('');
    }

    function renderFilters() {
        const prefs = store.get(`fr.prefs.${site}`, {});
        const scopes = prefs.scopes || Object.keys(info.scopes);
        $('scopes').innerHTML = Object.entries(info.scopes).map(([k, label]) =>
            `<label class="pill"><input type="checkbox" name="scope" value="${k}" ${scopes.includes(k) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('');
        const statuses = prefs.statuses || ['publish', 'draft', 'pending', 'private', 'future'];
        $('statuses').innerHTML = info.statuses.map(s =>
            `<label class="pill"><input type="checkbox" name="status" value="${s}" ${statuses.includes(s) ? 'checked' : ''}><span>${s[0].toUpperCase() + s.slice(1)}</span></label>`).join('');
        const types = prefs.types || [];
        $('types').innerHTML = info.types.map(t =>
            `<label class="pill"><input type="checkbox" name="type" value="${esc(t.type)}" ${types.includes(t.type) ? 'checked' : ''}><span>${esc(t.type)}</span><span class="n">${fmt(t.n)}</span></label>`).join('');
        $('optCase').checked = !!prefs.case;
        $('optWord').checked = !!prefs.word;
        $('optTags').checked = !!prefs.skipTags;
        updateFilterCount();
    }

    const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

    function options() {
        return {
            find: $('find').value,
            replace: $('replace').value,
            case: $('optCase').checked,
            word: $('optWord').checked,
            skipTags: $('optTags').checked,
            scopes: checked('scope'),
            statuses: checked('status'),
            types: checked('type'),
            ids: $('ids').value.trim(),
        };
    }

    function savePrefs() {
        const o = options();
        store.set(`fr.prefs.${site}`, { scopes: o.scopes, statuses: o.statuses, types: o.types, case: o.case, word: o.word, skipTags: o.skipTags });
        updateFilterCount();
        updateActionbar();
    }

    function updateFilterCount() {
        const o = options();
        const n = (o.types.length ? 1 : 0) + (o.statuses.length !== 5 ? 1 : 0) + (o.ids ? 1 : 0);
        $('filterCount').textContent = n || '';
    }

    /* ───── Search ───── */
    async function search(e) {
        e?.preventDefault();
        const o = options();
        if (!info) return toast('This site\'s database is not reachable - pick another site.', 'err');
        if (o.find.trim().length < 2) {
            $('find').focus();
            return toast('Type at least 2 characters to find.', 'err');
        }
        if (!o.scopes.length) return toast('Pick at least one place to search in.', 'err');
        if (!o.statuses.length) return toast('Pick at least one status in Filters.', 'err');
        savePrefs();
        $('searchBtn').classList.add('busy');
        $('searchBtn').disabled = true;
        $('results').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
        $('actionbar').hidden = true;
        try {
            result = await api('search.php', o);
            searched = o;
            done = new Set();
            selected = new Set(result.fields.filter(f => !f.blocked).map(key));
            viewScope = '';
            viewText = '';
            shown = PAGE;
            renderResults();
        } catch (err) {
            result = null;
            $('results').innerHTML = `<div class="empty-state"><div class="big">⚠️</div><h2>Search failed</h2><p>${esc(err.message)}</p></div>`;
        } finally {
            $('searchBtn').classList.remove('busy');
            $('searchBtn').disabled = false;
        }
    }

    function fieldLabel(f) {
        if (f.kind === 'post') return { post_title: 'Title', post_content: 'Content', post_excerpt: 'Excerpt' }[f.field];
        if (f.field === '_elementor_data') return 'Elementor';
        if (SEO_NAMES[f.field]) return SEO_NAMES[f.field];
        if (f.scope === 'seo') return 'SEO · ' + f.field.replace('_yoast_wpseo_', '');
        return 'Custom field';
    }

    function snippetHtml(s) {
        const rep = s.replacement === '' ? '<ins class="empty"></ins>' : `<ins>${esc(s.replacement)}</ins>`;
        return `<div class="snip">${esc(s.before)}<del>${esc(s.match)}</del>${rep}${esc(s.after)}</div>`;
    }

    function visibleFields() {
        const t = viewText.toLowerCase();
        return result.fields.filter(f => (!viewScope || f.scope === viewScope)
            && (!t || (result.posts[f.post_id]?.title || '').toLowerCase().includes(t) || String(f.post_id) === t || f.field.toLowerCase().includes(t)));
    }

    function renderResults() {
        if (!result) return;
        const r = result;
        if (!r.fields.length) {
            $('results').innerHTML = `<div class="empty-state"><div class="big">🙌</div><h2>No matches for “${esc(searched.find)}”</h2>
                <p>on ${esc(info.label)}. Try turning off <b>Match case</b> / <b>Whole word</b>, searching in more places, or widening the Filters.</p></div>`;
            $('actionbar').hidden = true;
            return;
        }
        const byScope = {};
        r.fields.forEach(f => { byScope[f.scope] = (byScope[f.scope] || 0) + 1; });
        const postCount = Object.keys(r.posts).length;

        const fields = visibleFields();
        const groups = new Map();
        fields.forEach(f => { if (!groups.has(f.post_id)) groups.set(f.post_id, []); groups.get(f.post_id).push(f); });
        const ids = [...groups.keys()];

        const elementorSkipped = !searched.scopes.includes('elementor');
        let html = `<div class="summary">
            <span class="stat"><b>${fmt(r.matches)}</b> matches</span>
            <span class="stat"><b>${fmt(r.fields.length)}</b> fields</span>
            <span class="stat"><b>${fmt(postCount)}</b> posts</span>
            <span class="stat muted">${(r.ms / 1000).toFixed(1)}s · ${esc(info.label)}</span>
            <span class="grow"></span>
            <input class="rfilter" id="rfilter" type="search" placeholder="Filter by title or ID…" value="${esc(viewText)}" aria-label="Filter results">
        </div>
        <div class="summary chips" id="scopeFilter">
            <label class="pill"><input type="radio" name="vscope" value="" ${!viewScope ? 'checked' : ''}><span>All</span><span class="n">${fmt(r.fields.length)}</span></label>
            ${Object.entries(byScope).map(([k, n]) => `<label class="pill"><input type="radio" name="vscope" value="${k}" ${viewScope === k ? 'checked' : ''}><span>${esc(info.scopes[k])}</span><span class="n">${fmt(n)}</span></label>`).join('')}
        </div>`;
        if (r.truncated) {
            html += `<div class="notice warn">⚠️ <span>Showing the first <b>${fmt(r.limit)}</b> fields. Replace these, then search again for the rest - or narrow the search with Filters.</span></div>`;
        }
        if (elementorSkipped && /^(landing|botphonic)$/.test(site)) {
            html += `<div class="notice warn">ℹ️ <span><b>Elementor data</b> isn't included. Pages built with Elementor show their Elementor copy, so changing only Content won't change what visitors see.</span></div>`;
        }
        html += `<div id="lastOp"></div>`;
        html += ids.slice(0, shown).map(id => postHtml(id, groups.get(id))).join('');
        if (!ids.length) html += `<div class="empty-state"><p>No results match this filter.</p></div>`;
        if (ids.length > shown) html += `<button class="btn loadmore" id="loadMore" type="button">Show ${fmt(Math.min(PAGE, ids.length - shown))} more of ${fmt(ids.length - shown)} posts</button>`;
        $('results').innerHTML = html;
        if (lastOp) renderLastOp();
        $('actionbar').hidden = false;
        updateActionbar();
    }

    function postHtml(id, fields) {
        const p = result.posts[id] || { id, title: '(deleted)', type: '?', status: '?' };
        const home = result.home || info.home;
        const usable = fields.filter(f => !f.blocked && !done.has(key(f)));
        const all = usable.length && usable.every(f => selected.has(key(f)));
        const some = usable.some(f => selected.has(key(f)));
        const hasElementor = fields.some(f => f.field === '_elementor_data');
        return `<article class="post ${some ? 'sel' : ''}" data-post="${id}">
            <div class="post-head">
                <input type="checkbox" data-post-check="${id}" ${all ? 'checked' : ''} ${usable.length ? '' : 'disabled'} aria-label="Select all fields of this post">
                <h3 title="${esc(p.title)}">${esc(p.title) || '<span class="muted">(no title)</span>'}<small>#${id}</small></h3>
                <span class="badge">${esc(p.type)}</span>
                <span class="badge ${esc(p.status)}">${esc(p.status)}</span>
                <span class="post-links">
                    ${home ? `<a href="${esc(home)}/?p=${id}" target="_blank" rel="noopener" title="Open on the site">View ↗</a>
                    <a href="${esc(home)}/wp-admin/post.php?post=${id}&action=${hasElementor ? 'elementor' : 'edit'}" target="_blank" rel="noopener" title="Edit in WordPress">Edit ↗</a>` : ''}
                </span>
            </div>
            ${fields.map(fieldHtml).join('')}
        </article>`;
    }

    function fieldHtml(f) {
        const k = key(f);
        const isDone = done.has(k);
        const fmtBadge = f.format === 'json' ? '<span class="badge">JSON</span>' : f.format === 'serialized' ? '<span class="badge">Serialized</span>' : '';
        const more = f.count > f.snippets.length ? `<span class="more">+ ${plural(f.count - f.snippets.length, 'more match', 'more matches')} in this field</span>` : '';
        return `<div class="fld ${isDone ? 'done' : ''} ${f.blocked ? 'blocked' : ''}">
            <input type="checkbox" data-field="${esc(k)}" ${selected.has(k) && !isDone ? 'checked' : ''} ${f.blocked || isDone ? 'disabled' : ''} aria-label="Select ${esc(fieldLabel(f))}">
            <div class="fld-name">${esc(fieldLabel(f))}
                ${f.kind === 'meta' && f.field !== '_elementor_data' ? `<code>${esc(f.field)}</code>` : ''}
                <span class="meta"><span class="badge count">${plural(f.count, 'match', 'matches')}</span>${fmtBadge}${isDone ? '<span class="badge publish">Replaced ✓</span>' : ''}</span>
            </div>
            <div class="snips">${f.snippets.map(snippetHtml).join('')}${more}${f.blocked ? `<span class="reason">⚠️ ${esc(f.blocked)}</span>` : ''}</div>
        </div>`;
    }

    /* ───── Selection ───── */
    function selectable() { return visibleFields().filter(f => !f.blocked && !done.has(key(f))); }

    function selectedFields() { return result ? result.fields.filter(f => selected.has(key(f)) && !done.has(key(f)) && !f.blocked) : []; }

    function stale() {
        if (!searched) return false;
        const o = options();
        return ['find', 'replace', 'case', 'word', 'skipTags'].some(k => o[k] !== searched[k]);
    }

    function updateActionbar() {
        if (!result) return;
        const sel = selectedFields();
        const matches = sel.reduce((n, f) => n + f.count, 0);
        const posts = new Set(sel.map(f => f.post_id)).size;
        const pool = selectable();
        $('selAll').checked = pool.length > 0 && pool.every(f => selected.has(key(f)));
        $('selAll').indeterminate = !$('selAll').checked && pool.some(f => selected.has(key(f)));
        const isStale = stale();
        $('selText').textContent = isStale
            ? 'Find/Replace changed - search again to preview'
            : sel.length ? `${plural(sel.length, 'field')} · ${plural(posts, 'post')} · ${plural(matches, 'match', 'matches')}` : 'Nothing selected';
        $('replaceBtn').disabled = !sel.length || isStale;
        $('replaceBtn').textContent = sel.length && !isStale ? `Replace ${plural(matches, 'match', 'matches')}` : 'Replace selected';
    }

    function refreshPostState(id) {
        const art = document.querySelector(`article[data-post="${id}"]`);
        if (!art) return;
        const fields = result.fields.filter(f => f.post_id === id && !f.blocked && !done.has(key(f)));
        const box = art.querySelector('[data-post-check]');
        const n = fields.filter(f => selected.has(key(f))).length;
        box.checked = fields.length > 0 && n === fields.length;
        box.indeterminate = n > 0 && n < fields.length;
        art.classList.toggle('sel', n > 0);
    }

    /* ───── Replace ───── */
    function confirmReplace() {
        const sel = selectedFields();
        if (!sel.length || stale()) return;
        const matches = sel.reduce((n, f) => n + f.count, 0);
        const posts = new Set(sel.map(f => f.post_id)).size;
        $('cSite').textContent = info.label;
        $('cLive').hidden = !LIVE_SITES.includes(site);
        $('cFind').textContent = searched.find;
        $('cRepl').textContent = searched.replace;
        $('cRepl').className = searched.replace === '' ? 'empty' : '';
        $('cSummary').innerHTML = `<b>${plural(matches, 'match', 'matches')}</b> in ${plural(sel.length, 'field')} across ${plural(posts, 'post')}.`;
        $('cGo').textContent = `Replace ${plural(matches, 'match', 'matches')}`;
        $('confirm').returnValue = '';
        $('confirm').showModal();
        $('confirm').querySelector('[value="cancel"]').focus();
    }

    let lastOp = null;
    async function doReplace() {
        const sel = selectedFields();
        $('replaceBtn').disabled = true;
        $('replaceBtn').textContent = 'Replacing…';
        try {
            const res = await api('replace.php', { ...searched, targets: sel.map(f => ({ kind: f.kind, id: f.id, field: f.field })) });
            res.changed.forEach(c => done.add(`${c.kind}:${c.id}`));
            lastOp = res;
            toast(res.msg, 'ok');
            if (res.skipped?.length) toast(`${plural(res.skipped.length, 'field')} skipped: ${res.skipped[0].reason}`, 'err');
            renderResults();
        } catch (e) {
            toast(e.message, 'err');
            updateActionbar();
        }
    }

    function renderLastOp() {
        const el = $('lastOp');
        if (!el || !lastOp) return;
        const hints = [];
        if (LIVE_SITES.includes(site)) hints.push('If the site uses a page cache, purge it to see the change.');
        el.innerHTML = `<div class="notice ok">✓ <span><b>${esc(lastOp.msg)}</b> ${plural(lastOp.posts, 'post')} updated. ${hints.join(' ')}</span>
            <button class="btn sm" type="button" data-undo="${esc(lastOp.op)}">Undo</button></div>`;
    }

    async function undo(id, btn) {
        if (!confirm(`Undo this replace on ${info.label}?\n\nFields edited again since then are left alone.`)) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Undoing…'; }
        try {
            const res = await api('undo.php', { id });
            toast(res.msg, 'ok');
            if (lastOp?.op === id) {
                lastOp.changed.forEach(c => done.delete(`${c.kind}:${c.id}`));
                lastOp = null;
                renderResults();
            }
            if (!$('drawer').hidden) loadHistory();
        } catch (e) {
            toast(e.message, 'err');
            if (btn) { btn.disabled = false; btn.textContent = 'Undo'; }
        }
    }

    /* ───── History ───── */
    function openHistory() {
        $('drawer').hidden = false;
        $('scrim').hidden = false;
        $('hSite').textContent = info?.label || site;
        loadHistory();
        $('hClose').focus();
    }
    function closeHistory() {
        $('drawer').hidden = true;
        $('scrim').hidden = true;
    }
    async function loadHistory() {
        $('hList').innerHTML = '<div class="skeleton" style="height:80px"></div>';
        try {
            const { ops } = await api('history.php');
            $('hList').innerHTML = ops.length ? ops.map(op => `<div class="op ${op.undone ? 'undone' : ''}">
                <div class="diff-big"><del>${esc(op.find)}</del><span>→</span>${op.replace === '' ? '<ins class="empty"></ins>' : `<ins>${esc(op.replace)}</ins>`}</div>
                <div class="op-meta">
                    <span>${plural(op.matches, 'match', 'matches')} · ${plural(op.fields, 'field')} · ${plural(op.posts, 'post')}</span>
                    <span class="grow"></span>
                    <span title="${esc(op.time)}">${esc(new Date(op.time).toLocaleString())}</span>
                    ${op.undone ? '<span class="badge">Undone</span>' : op.canUndo ? `<button class="btn sm" type="button" data-undo="${esc(op.id)}">Undo</button>` : ''}
                </div></div>`).join('')
                : '<div class="empty-state"><p>No replacements on this site yet.</p></div>';
        } catch (e) {
            $('hList').innerHTML = `<p class="reason">${esc(e.message)}</p>`;
        }
    }

    /* ───── Events ───── */
    $('form').addEventListener('submit', search);
    $('form').addEventListener('change', savePrefs);
    ['find', 'replace', 'ids'].forEach(id => $(id).addEventListener('input', () => { updateActionbar(); updateFilterCount(); }));
    $('swap').addEventListener('click', () => {
        [$('find').value, $('replace').value] = [$('replace').value, $('find').value];
        updateActionbar();
        $('find').focus();
    });
    $('moreBtn').addEventListener('click', () => {
        const open = $('filters').hidden;
        $('filters').hidden = !open;
        $('moreBtn').setAttribute('aria-expanded', open);
    });
    document.querySelector('[data-all="types"]').addEventListener('click', () => {
        document.querySelectorAll('input[name="type"]').forEach(i => { i.checked = false; });
        savePrefs();
    });

    $('sites').addEventListener('click', e => {
        const b = e.target.closest('button[data-key]');
        if (!b || b.dataset.key === site) return;
        if (selectedFields().length && !confirm('Switch site? The current results will be cleared.')) return;
        site = b.dataset.key;
        result = null;
        searched = null;
        lastOp = null;
        $('actionbar').hidden = true;
        $('results').innerHTML = `<div class="empty-state"><div class="big">🔁</div><h2>Switched to ${esc(b.textContent.replace('LIVE', '').trim())}</h2><p>Press Search to look in this site.</p></div>`;
        loadSite().then(() => { if ($('find').value.trim().length >= 2) search(); });
    });

    $('results').addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.field) {
            t.checked ? selected.add(t.dataset.field) : selected.delete(t.dataset.field);
            const f = result.fields.find(x => key(x) === t.dataset.field);
            refreshPostState(f.post_id);
        } else if (t.dataset.postCheck) {
            const id = Number(t.dataset.postCheck);
            result.fields.filter(f => f.post_id === id && !f.blocked && !done.has(key(f))).forEach(f => {
                t.checked ? selected.add(key(f)) : selected.delete(key(f));
            });
            document.querySelectorAll(`article[data-post="${id}"] [data-field]:not(:disabled)`).forEach(i => { i.checked = t.checked; });
            refreshPostState(id);
        } else if (t.name === 'vscope') {
            viewScope = t.value;
            shown = PAGE;
            renderResults();
            return;
        }
        updateActionbar();
    });
    let filterTimer;
    $('results').addEventListener('input', e => {
        if (e.target.id !== 'rfilter') return;
        clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
            viewText = e.target.value.trim();
            shown = PAGE;
            renderResults();
            const f = $('rfilter');
            f.focus();
            f.setSelectionRange(f.value.length, f.value.length);
        }, 200);
    });
    $('results').addEventListener('click', e => {
        if (e.target.id === 'loadMore') {
            shown += PAGE;
            renderResults();
        }
    });
    document.addEventListener('click', e => {
        const u = e.target.closest('[data-undo]');
        if (u) undo(u.dataset.undo, u);
    });

    $('selAll').addEventListener('change', e => {
        selectable().forEach(f => { e.target.checked ? selected.add(key(f)) : selected.delete(key(f)); });
        renderResults();
    });
    $('replaceBtn').addEventListener('click', confirmReplace);
    $('confirm').addEventListener('close', () => { if ($('confirm').returnValue === 'go') doReplace(); });

    $('historyBtn').addEventListener('click', openHistory);
    $('hClose').addEventListener('click', closeHistory);
    $('scrim').addEventListener('click', closeHistory);

    $('theme').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (e) { }
    });
    document.addEventListener('keydown', e => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (e.key === '/' && !typing) { e.preventDefault(); $('find').focus(); $('find').select(); }
        if (e.key === 'Escape' && !$('drawer').hidden) closeHistory();
    });

    // Prefill from the URL (?find=...&replace=...) so other tools can link here.
    const qp = new URLSearchParams(location.search);
    if (qp.get('find')) $('find').value = qp.get('find');
    if (qp.get('replace')) $('replace').value = qp.get('replace');
    loadSite().then(() => { if (qp.get('find')) search(); else $('find').focus(); });
})();
