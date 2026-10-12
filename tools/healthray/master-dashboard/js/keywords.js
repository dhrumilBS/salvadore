/* ══════════════════════════ Focus Keywords tab ══════════════════════════
 * Port of the standalone ../focus-keyword/ duplicate-keyword auditor, plus
 * focus-keyword editing.
 * The server (api/kw_list.php) returns every post of one type/status with its
 * Yoast focus keyword, categories, real URL and a duplicate flag; search,
 * category/keyword/presence filters, sorting, paging, column visibility and
 * the CSV/clipboard exports all run client-side over those rows. Only the
 * current page is rendered, so a few thousand rows stay fast.
 *
 * Editing: nothing auto-saves. Enter in a keyword input only STAGES the value
 * (st.edits, keyed by post ID, with the value the row was loaded with as
 * `expected`); the floating save bar's "Review & save" lists every change in
 * confirmDialog() and sends one all-or-nothing batch to api/kw_save.php,
 * which rejects the whole batch if any post's keyword changed since it was
 * loaded. Empty value = remove the keyword. After a save the list reloads,
 * so duplicate flags, stats and the conflicting-keyword panel are fresh.
 *
 * Globals (everything else stays inside the IIFE):
 *   bindKeywordsTab()  listeners only - called once at DOMContentLoaded
 *   loadKeywords()     first show / reload (SITE is pinned by then)
 *   kwHandleKey(e)     every keydown while this tab is active; true = handled
 *   kwHasUnsaved()     true while keyword edits are staged (or typed but not staged)
 */
(function () {
    'use strict';

    const COLS = [
        { key: 'sel', label: 'Select', sort: null, noMenu: true },
        { key: 'no', label: '#', sort: null },
        { key: 'id', label: 'ID', sort: 'id' },
        { key: 'url', label: 'Original URL', sort: 'url', locked: true },
        { key: 'slug', label: 'Post Name', sort: 'slug' },
        { key: 'categories', label: 'Category', sort: 'categories' },
        { key: 'post_status', label: 'Status', sort: 'post_status' },
        { key: 'post_date', label: 'Published', sort: 'post_date' },
        { key: 'post_modified', label: 'Last Modified', sort: 'post_modified' },
        { key: 'focus_keyword', label: 'Focus Keyword', sort: 'focus_keyword' },
    ];
    const PAGE_LENS = [10, 25, 50, 100, 250, 500];
    const FALLBACK_STATUSES = { publish: 'Published', draft: 'Draft', pending: 'Pending', private: 'Private', future: 'Scheduled', trash: 'Trash', any: 'Any status' };
    const CSV_HEAD = ['No', 'ID', 'Original URL', 'Post Title', 'Post Name', 'Category', 'Status', 'Published', 'Last Modified', 'Focus Keyword', 'Duplicate'];

    const st = {
        options: null,     // kw_options.php response
        rows: [],          // everything kw_list.php returned
        view: [],          // after filters + sort
        siteHome: '',
        postType: 'post',
        status: 'publish',
        onlyDup: false,
        search: '',
        cat: '',           // category name
        kwKey: '',         // exact keyword (normalised key)
        kwLabel: '',
        presence: '',      // '' | with | without
        sortKey: '',       // '' = server order
        sortDir: 1,
        page: 1,
        pageLen: 100,
        hidden: new Set(),
        panelOpen: false,
        loadedOnce: false,
        // editing
        edits: new Map(),    // post id -> { expected, value, title } (staged, not saved)
        editing: new Set(),  // post ids whose keyword input is open
        drafts: new Map(),   // post id -> text typed in an open input
        selected: new Set(), // post ids ticked in the checkbox column
        saving: false,
        eff: null,           // effective keyword key -> rows (staged values applied), rebuilt lazily
    };
    const KW_MAX_LEN = 191;

    const $ = id => document.getElementById(id);
    const nextRowsSignal = latestOnly();
    const nextOptionsSignal = latestOnly();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    let openMenuId = '';
    let gAt = 0;

    /* ---------- prefs (localStorage, md.kw.*) ---------- */
    function prefGet(key, def) {
        try {
            const v = localStorage.getItem('md.kw.' + key);
            return v === null ? def : v;
        } catch (e) { return def; }
    }
    function prefSet(key, value) {
        try { localStorage.setItem('md.kw.' + key, String(value)); } catch (e) { /* storage blocked */ }
    }
    const sitePref = name => (SITE || 'default') + '.' + name;

    /* ---------- small helpers ---------- */
    const fmtDate = v => (v ? String(v).split(' ')[0] : '');
    const fmtMs = ms => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
    const dash = '<span class="url-empty">—</span>';
    const cleanKw = v => String(v ?? '').replace(/\s+/g, ' ').trim();
    const kwKeyOf = v => cleanKw(v).toLowerCase();
    const loadedKw = r => String(r.focus_keyword || '').trim();
    /** The keyword a row will have after saving (staged value, else what was loaded). */
    const effKw = r => (st.edits.has(r.id) ? st.edits.get(r.id).value : loadedKw(r));
    const rowById = id => st.rows.find(r => r.id === id);

    function siteFile(suffix) {
        const safe = s => String(s || '').replace(/[^a-z0-9_-]+/gi, '-');
        return `focus-keywords-${safe(SITE)}-${safe(st.postType)}-${suffix}.csv`;
    }

    /* ══════════════════════════ Loading ══════════════════════════ */

    async function loadKeywords() {
        if (!st.options) {
            await loadOptions();
            await loadRows();
        } else {
            // Reload: counts may have changed after a write on another tab.
            loadOptions();
            await loadRows();
        }
    }

    async function loadOptions() {
        let json = null;
        try {
            json = await api('kw_options.php', { signal: nextOptionsSignal() });
            if (!json.success) throw new Error(json.msg || 'Server error');
        } catch (err) {
            if (isAbort(err)) return;
            console.error(err);
            toast('Failed to load post types / categories', 'err');
            json = null;
        }
        st.options = json || {
            post_types: [{ name: 'post', total: 0, statuses: {} }, { name: 'page', total: 0, statuses: {} }],
            statuses: FALLBACK_STATUSES,
            categories: [],
        };
        populateOptions();
    }

    function populateOptions() {
        const statuses = st.options.statuses || FALLBACK_STATUSES;
        const wantedStatus = st.loadedOnce ? st.status : prefGet(sitePref('status'), 'publish');
        st.status = Object.prototype.hasOwnProperty.call(statuses, wantedStatus) ? wantedStatus : 'publish';
        if (!st.loadedOnce) st.postType = prefGet(sitePref('postType'), 'post');
        renderStatusOptions();
        renderTypeOptions();

        const cats = st.options.categories || [];
        $('kw-category').innerHTML = '<option value="">All categories</option>' + cats.map(c =>
            `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} · ${fmtNum(c.count)}</option>`
        ).join('');
        syncCategorySelect();
    }

    /** Posts of type `t` in `status` ('any' = all). */
    function typeCount(t, status) {
        return status === 'any' ? (t.total || 0) : ((t.statuses || {})[status] || 0);
    }

    /** Status comes first (same as the Content tab): every status that has posts, with the site-wide count. */
    function renderStatusOptions() {
        const statuses = (st.options && st.options.statuses) || FALLBACK_STATUSES;
        const types = (st.options && st.options.post_types) || [];
        $('kw-status').innerHTML = Object.entries(statuses).map(([value, label]) => {
            const n = types.reduce((sum, t) => sum + typeCount(t, value), 0);
            if (types.length && !n && value !== st.status) return '';
            return `<option value="${escapeHtml(value)}">${escapeHtml(label)}${types.length ? ' · ' + fmtNum(n) : ''}</option>`;
        }).join('');
        $('kw-status').value = st.status;
    }

    /** Only types that have posts in the selected status, with that count. Returns true if the type had to change. */
    function renderTypeOptions() {
        const types = ((st.options && st.options.post_types) || []).filter(t => typeCount(t, st.status) > 0);
        const before = st.postType;
        if (types.length && !types.some(t => t.name === st.postType)) {
            st.postType = (types.find(t => t.name === 'post') || types[0]).name;
        }
        $('kw-post-type').innerHTML = types.map(t =>
            `<option value="${escapeHtml(t.name)}">${escapeHtml(typeLabel(t.name))} · ${fmtNum(typeCount(t, st.status))}</option>`
        ).join('') || '<option value="post">No posts in this status</option>';
        $('kw-post-type').value = st.postType;
        return st.postType !== before;
    }

    function syncCategorySelect() {
        const sel = $('kw-category');
        const match = [...sel.options].find(o => o.value.toLowerCase().trim() === st.cat.toLowerCase().trim());
        sel.value = st.cat && match ? match.value : '';
    }

    async function loadRows() {
        const signal = nextRowsSignal();
        $('kw-loading').classList.add('show');
        const t0 = performance.now();
        try {
            const json = await api('kw_list.php', {
                params: { post_type: st.postType, post_status: st.status, only_duplicate: st.onlyDup ? 1 : '' },
                signal,
            });
            if (!json.success) throw new Error(json.msg || 'Server error');
            ingest(json);
            updatePerf(performance.now() - t0, json.server_time_ms, json.row_count);
        } catch (err) {
            if (isAbort(err)) return;
            console.error(err);
            toast('Failed to load posts' + (err && err.message ? ' — ' + err.message : ''), 'err');
            st.rows = [];
        } finally {
            if (!signal.aborted) $('kw-loading').classList.remove('show');
        }
        if (signal.aborted) return;
        st.loadedOnce = true;
        render();
    }

    function ingest(json) {
        st.siteHome = String(json.site_home || '').replace(/\/+$/, '');
        let host = st.siteHome;
        try { host = new URL(st.siteHome).host; } catch (e) { /* keep raw */ }
        $('kw-site-host').textContent = host || '—';
        $('kw-site-host').title = st.siteHome;

        // Duplicate groups cycle through 4 tints, in server order (as the original did).
        const groups = new Map();
        let next = 0;
        st.rows = (json.data || []).map((r, i) => {
            let group = 0;
            if (r.duplicate && r.kw_key) {
                if (!groups.has(r.kw_key)) groups.set(r.kw_key, (next++ % 4) + 1);
                group = groups.get(r.kw_key);
            }
            return Object.assign({}, r, {
                no: i + 1,
                group,
                _hay: [r.url, r.title, r.slug, r.focus_keyword, r.id].join('\n').toLowerCase(),
                _cats: (r.category_list || []).map(c => String(c).toLowerCase().trim()),
            });
        });
        // Staged edits survive a reload (they carry their own `expected`); open inputs,
        // drafts and ticks only for posts that are still in the set.
        const ids = new Set(st.rows.map(r => r.id));
        [st.editing, st.selected].forEach(set => set.forEach(id => { if (!ids.has(id)) set.delete(id); }));
        st.drafts.forEach((_, id) => { if (!ids.has(id)) st.drafts.delete(id); });
        st.eff = null;
    }

    function updatePerf(totalMs, serverMs, rowCount) {
        const meter = $('kw-perf');
        $('kw-perf-total').textContent = fmtMs(totalMs);
        $('kw-perf-server').textContent = serverMs != null ? ` · server ${fmtMs(serverMs)}` : '';
        meter.classList.remove('kw-perf-good', 'kw-perf-warn', 'kw-perf-slow');
        meter.classList.add(totalMs < 500 ? 'kw-perf-good' : totalMs < 1500 ? 'kw-perf-warn' : 'kw-perf-slow');
        meter.title = `Fetched ${fmtNum(rowCount)} rows · round-trip ${fmtMs(totalMs)}` +
            (serverMs != null ? ` · server query ${fmtMs(serverMs)}` : '');
    }

    /* ══════════════════════════ Filter / sort ══════════════════════════ */

    function applyFilters() {
        const terms = st.search.toLowerCase().split(/\s+/).filter(Boolean);
        const cat = st.cat.toLowerCase().trim();
        st.view = st.rows.filter(r => {
            // A post can sit in several categories - match any of them, not the joined string.
            if (cat && !r._cats.includes(cat)) return false;
            if (st.kwKey && r.kw_key !== st.kwKey) return false;
            if (st.presence === 'with' && !r.focus_keyword) return false;
            if (st.presence === 'without' && r.focus_keyword) return false;
            for (const t of terms) if (!r._hay.includes(t)) return false;
            return true;
        });

        if (st.sortKey) {
            const key = st.sortKey;
            const dir = st.sortDir;
            st.view.sort((a, b) => {
                const c = key === 'id' ? a.id - b.id : collator.compare(String(a[key] || ''), String(b[key] || ''));
                return c ? c * dir : a.no - b.no;
            });
        }
        clampPage();
    }

    function clampPage() {
        const pages = Math.max(1, Math.ceil(st.view.length / st.pageLen));
        st.page = Math.min(Math.max(1, st.page), pages);
    }

    const hasFilters = () => !!(st.search || st.cat || st.kwKey || st.presence);

    function clearAllFilters() {
        st.search = '';
        $('kw-search').value = '';
        st.cat = '';
        st.kwKey = '';
        st.kwLabel = '';
        st.presence = '';
        st.page = 1;
        syncCategorySelect();
        render();
    }

    function setCategory(name) {
        const same = st.cat && st.cat.toLowerCase().trim() === String(name || '').toLowerCase().trim();
        st.cat = same ? '' : String(name || '');
        st.page = 1;
        syncCategorySelect();
        render();
    }

    function setKeyword(key, label) {
        const same = st.kwKey === key;
        st.kwKey = same ? '' : key;
        st.kwLabel = same ? '' : label;
        st.page = 1;
        render();
        return !same;
    }

    function setPresence(mode) {
        st.presence = st.presence === mode ? '' : mode;
        st.page = 1;
        render();
    }

    function setOnlyDup(on) {
        st.onlyDup = !!on;
        $('kw-only-dup').checked = st.onlyDup;
        prefSet('onlyDup', st.onlyDup ? '1' : '0');
        renderStatCards();
        loadRows();
    }

    /** New data set (type/status change): the old filters would point at rows that no longer exist. */
    function resetForNewSet() {
        st.cat = '';
        st.kwKey = '';
        st.kwLabel = '';
        st.presence = '';
        st.sortKey = '';
        st.page = 1;
        st.selected.clear();
        st.editing.clear();
        st.drafts.clear();
        syncCategorySelect();
    }

    /* ══════════════════════════ Render ══════════════════════════ */

    function render() {
        applyFilters();
        renderStats();
        renderStatCards();
        renderChips();
        renderHead();
        renderBody();
        if (st.panelOpen) renderPanel();
        renderSaveBar();
    }

    function renderStats() {
        const rows = st.rows;
        let withKw = 0, dups = 0;
        const uniq = new Set();
        rows.forEach(r => {
            if (r.focus_keyword) withKw++;
            if (r.duplicate) {
                dups++;
                if (r.focus_keyword) uniq.add(r.kw_key);
            }
        });
        setKpi('kw-stat-total', rows.length);
        setKpi('kw-stat-with', withKw);
        setKpi('kw-stat-dup', dups);
        setKpi('kw-stat-uniq', uniq.size);
        setKpi('kw-stat-without', rows.length - withKw);
    }

    function renderStatCards() {
        document.querySelectorAll('#keywordsView .kw-stat').forEach(c => {
            const s = c.dataset.kwStat;
            const on = (s === 'with' && st.presence === 'with') || (s === 'without' && st.presence === 'without') ||
                (s === 'dup' && st.onlyDup) || (s === 'uniq' && st.panelOpen) ||
                (s === 'all' && !st.presence && !st.cat && !st.kwKey && !st.onlyDup && !st.search);
            c.classList.toggle('active', !!on);
            c.setAttribute('aria-pressed', String(!!on));
        });
    }

    function chip(label, value, clearKey, title) {
        return `<span class="kw-chip"><span class="kw-chip-label">${escapeHtml(label)}</span><span class="kw-chip-val">${escapeHtml(value)}</span>` +
            `<button type="button" class="kw-chip-clear" data-kw-clear="${clearKey}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">×</button></span>`;
    }

    function renderChips() {
        const parts = [];
        if (st.cat) parts.push(chip('Category', st.cat, 'cat', 'Clear category filter'));
        if (st.kwKey) parts.push(chip('Keyword', st.kwLabel || st.kwKey, 'kw', 'Clear keyword filter'));
        if (st.presence) parts.push(chip('Keyword', st.presence === 'with' ? 'is set' : 'is missing', 'presence', 'Clear keyword presence filter'));
        if (parts.length > 1) parts.push('<button type="button" class="btn small" data-kw-clear="all">Clear all</button>');
        const box = $('kw-chips');
        box.innerHTML = parts.join('');
        box.hidden = !parts.length;
    }

    const visibleCols = () => COLS.filter(c => !st.hidden.has(c.key));

    function renderHead() {
        $('kw-thead').innerHTML = '<tr>' + visibleCols().map(c => {
            if (c.key === 'sel') return '<th class="kw-sel"><input type="checkbox" id="kw-sel-all" title="Select every row on this page" aria-label="Select every row on this page"></th>';
            if (!c.sort) return `<th>${c.label}</th>`;
            const active = st.sortKey === c.sort;
            const arrow = active ? (st.sortDir === 1 ? ' ↑' : ' ↓') : '';
            const aria = active ? (st.sortDir === 1 ? 'ascending' : 'descending') : 'none';
            return `<th data-kw-sort="${c.sort}" class="kw-sortable${c.key === 'url' ? ' url-col' : ''}${active ? ' sort-active' : ''}" aria-sort="${aria}" title="Sort by ${escapeHtml(c.label)}">${c.label}${arrow}</th>`;
        }).join('') + '</tr>';
    }

    function editUrl(id) {
        return /^https?:\/\//i.test(st.siteHome) ? `${st.siteHome}/wp-admin/post.php?post=${id}&action=edit` : '';
    }

    function cellHtml(key, r) {
        switch (key) {
            case 'sel':
                return `<td class="kw-sel"><input type="checkbox" data-kw-sel="${r.id}"${st.selected.has(r.id) ? ' checked' : ''} aria-label="Select #${r.id}"></td>`;
            case 'no':
                return `<td class="mono kw-no">${r.no}</td>`;
            case 'id': {
                const href = editUrl(r.id);
                return `<td>${href
                    ? `<a class="id-chip kw-id" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="Open #${r.id} in the WordPress editor">${r.id}</a>`
                    : `<span class="id-chip">${r.id}</span>`}</td>`;
            }
            case 'url': {
                const approx = r.approx
                    ? '<span class="kw-approx" title="No pretty permalink yet — this is the best-effort URL">approx</span>' : '';
                const title = r.title ? `<div class="kw-title" title="${escapeHtml(decodeEntities(r.title))}">${escapeHtml(decodeEntities(r.title))}</div>` : '';
                return `<td class="url-col"><div class="kw-url">${urlCellHtml(r.url)}${approx}</div>${title}</td>`;
            }
            case 'slug':
                return `<td class="mono kw-slug">${r.slug ? escapeHtml(r.slug) : dash}</td>`;
            case 'categories': {
                const list = r.category_list || [];
                if (!list.length) return `<td>${dash}</td>`;
                const cur = st.cat.toLowerCase().trim();
                return '<td><div class="kw-cats">' + list.map(c =>
                    `<button type="button" class="kw-cat${cur && String(c).toLowerCase().trim() === cur ? ' active' : ''}" data-kw-cat="${escapeHtml(c)}" title="Click to isolate this category">${escapeHtml(c)}</button>`
                ).join('') + '</div></td>';
            }
            case 'post_status':
                return `<td>${r.post_status ? statusBadge(r.post_status) : dash}</td>`;
            case 'post_date':
            case 'post_modified':
                return `<td class="mono kw-date">${r[key] ? escapeHtml(fmtDate(r[key])) : dash}</td>`;
            case 'focus_keyword':
                return `<td class="kw-kw">${kwCellInner(r)}</td>`;
        }
        return '<td></td>';
    }

    /* ══════════════════════════ Editing ══════════════════════════ */

    const EDIT_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

    /** Focus keyword cell: open input / staged value / stored badge / "add" placeholder. */
    function kwCellInner(r) {
        if (st.editing.has(r.id)) {
            const draft = st.drafts.has(r.id) ? st.drafts.get(r.id) : effKw(r);
            return `<div class="kw-edit">
                <input type="text" class="kw-edit-input" data-kw-input="${r.id}" value="${escapeHtml(draft)}" maxlength="${KW_MAX_LEN}"
                    placeholder="Focus keyword (empty = remove)" aria-label="Focus keyword for #${r.id}" autocomplete="off" spellcheck="false">
                <div class="kw-edit-hint" data-kw-hint="${r.id}">${hintHtml(r, draft)}</div>
            </div>`;
        }
        const editBtn = `<button type="button" class="kw-edit-btn" data-kw-edit="${r.id}" title="Edit focus keyword" aria-label="Edit focus keyword for #${r.id}">${EDIT_ICON}</button>`;
        if (st.edits.has(r.id)) {
            const e = st.edits.get(r.id);
            const clash = e.value ? othersUsing(r.id, e.value).length : 0;
            const now = e.value
                ? `<span class="kw-badge kw-staged${clash ? ' kw-staged-dup' : ''}" title="${clash ? 'Still shared with ' + pluralize(clash, 'other post') : 'Staged — not saved yet'}">${escapeHtml(e.value)}</span>`
                : '<span class="kw-staged-none">keyword removed</span>';
            return `<div class="kw-kwline">${now}${editBtn}<button type="button" class="kw-edit-btn" data-kw-revert="${r.id}" title="Undo this change" aria-label="Undo the change for #${r.id}">↺</button></div>
                <div class="kw-was">was <span>${e.expected ? escapeHtml(e.expected) : 'no keyword'}</span></div>`;
        }
        if (!r.focus_keyword) {
            return `<button type="button" class="kw-add" data-kw-edit="${r.id}" title="Add a focus keyword">+ add</button>`;
        }
        return `<div class="kw-kwline"><button type="button" class="kw-badge${r.duplicate ? ' kw-dup' : ''}${st.kwKey && st.kwKey === r.kw_key ? ' active' : ''}" data-kw-key="${escapeHtml(r.kw_key)}" data-kw-label="${escapeHtml(r.focus_keyword)}" title="Click to isolate every post using this keyword">${escapeHtml(r.focus_keyword)}</button>${editBtn}</div>`;
    }

    /** Effective keyword key -> rows, with staged values applied (loaded rows only). */
    function effIndex() {
        if (!st.eff) {
            st.eff = new Map();
            st.rows.forEach(r => {
                const k = kwKeyOf(effKw(r));
                if (!k) return;
                if (!st.eff.has(k)) st.eff.set(k, []);
                st.eff.get(k).push(r);
            });
        }
        return st.eff;
    }

    function othersUsing(id, value) {
        const k = kwKeyOf(value);
        return k ? (effIndex().get(k) || []).filter(o => o.id !== id) : [];
    }

    function hintHtml(r, value) {
        const v = cleanKw(value);
        if (!v) {
            return loadedKw(r) || st.edits.has(r.id)
                ? '<span class="kw-hint-warn">Empty — Enter removes the keyword</span>'
                : 'Type a keyword · Enter stages · Esc cancels';
        }
        const others = othersUsing(r.id, v);
        if (!others.length) return 'Enter stages · Esc cancels';
        const names = others.slice(0, 2).map(o => `<b>${escapeHtml(decodeEntities(o.title) || '#' + o.id)}</b>`).join(', ');
        return `<span class="kw-hint-warn">Also used by: ${names}${others.length > 2 ? ` +${others.length - 2} more` : ''}</span>`;
    }

    function openEdit(ids, focusId) {
        ids.forEach(id => st.editing.add(id));
        renderBody();
        renderSaveBar();
        focusInput(focusId !== undefined ? focusId : ids[0]);
    }

    function focusInput(id) {
        const input = id !== undefined && document.querySelector(`#kw-tbody input[data-kw-input="${id}"]`);
        if (!input) return false;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        return true;
    }

    /** Enter: stage (or unstage, when back to the loaded value) and close the input. */
    function commitEdit(id) {
        const r = rowById(id);
        const input = document.querySelector(`#kw-tbody input[data-kw-input="${id}"]`);
        if (!r || !input) return;
        const value = cleanKw(input.value);
        if (value.length > KW_MAX_LEN) { toast(`Keep it under ${KW_MAX_LEN} characters`, 'warn'); return; }
        stage(r, value);
        closeEdit(id);
    }

    function stage(r, value) {
        const expected = st.edits.has(r.id) ? st.edits.get(r.id).expected : loadedKw(r);
        if (value === expected) st.edits.delete(r.id);
        else st.edits.set(r.id, { expected, value, title: r.title || `#${r.id}` });
        st.eff = null;
    }

    function closeEdit(id) {
        const next = nextOpenAfter(id);
        st.editing.delete(id);
        st.drafts.delete(id);
        renderBody();
        if (st.panelOpen) renderPanel();
        renderSaveBar();
        if (next !== null) focusInput(next);
    }

    /** The open input after `id` on the current page (wrapping), for Enter-to-next. */
    function nextOpenAfter(id) {
        const ids = [...document.querySelectorAll('#kw-tbody input[data-kw-input]')].map(i => +i.dataset.kwInput);
        const at = ids.indexOf(id);
        const rest = ids.slice(at + 1).concat(ids.slice(0, Math.max(at, 0)));
        return rest.length ? rest[0] : null;
    }

    function closeAllEdits() {
        st.editing.clear();
        st.drafts.clear();
        renderBody();
        renderSaveBar();
    }

    function revertEdit(id) {
        st.edits.delete(id);
        st.eff = null;
        renderBody();
        if (st.panelOpen) renderPanel();
        renderSaveBar();
    }

    /** Typed-but-not-staged text counts as unsaved too. */
    const pendingDrafts = () => [...st.drafts].filter(([id, text]) => {
        const r = rowById(id);
        return r && st.editing.has(id) && cleanKw(text) !== effKw(r);
    }).length;

    /* ---------- "Edit group" from the conflicting-keyword panel ---------- */
    function editGroup(key, label) {
        st.search = '';
        $('kw-search').value = '';
        st.cat = '';
        st.presence = '';
        st.kwKey = key;
        st.kwLabel = label;
        st.page = 1;
        syncCategorySelect();
        const ids = st.rows.filter(r => r.kw_key === key).map(r => r.id);
        ids.forEach(id => st.editing.add(id));
        render();
        $('kw-table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        // The first post keeps its keyword: start typing in the second one.
        const open = st.view.filter(r => st.editing.has(r.id) && r.kw_key === key);
        focusInput((open[1] || open[0] || {}).id);
        if (ids.length > 1) toast(`Rename all but one of these ${ids.length} posts — Enter after each`, '', 4000);
    }

    /* ---------- bulk: stage "no keyword" for the ticked rows ---------- */
    function clearSelected() {
        const touched = st.rows.filter(r => st.selected.has(r.id) && effKw(r) !== '');
        if (!touched.length) { toast('None of the selected posts has a keyword to clear', 'warn'); return; }
        touched.forEach(r => { stage(r, ''); st.editing.delete(r.id); st.drafts.delete(r.id); });
        st.selected.clear();
        renderBody();
        if (st.panelOpen) renderPanel();
        renderSaveBar();
        toast(`${pluralize(touched.length, 'keyword')} staged for removal — Review & save to apply`, 'warn');
    }

    /* ---------- floating save / selection bar (built here, lives inside #keywordsView) ---------- */
    function ensureSaveBar() {
        let bar = $('kw-save-bar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'kw-save-bar';
        bar.className = 'kw-save-bar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Unsaved focus keyword changes');
        bar.innerHTML = `
            <div class="kw-bar-group" id="kw-bar-sel" hidden>
                <span class="kw-bar-info"><span class="kw-bar-pill kw-bar-pill-sel" id="kw-bar-sel-n">0</span> selected</span>
                <button type="button" class="btn small" data-kw-bar="clear-kw" title="Stage removal of the selected posts' focus keywords">Clear keyword</button>
                <button type="button" class="btn small" data-kw-bar="unselect">Unselect</button>
            </div>
            <div class="kw-bar-group" id="kw-bar-edits" hidden>
                <span class="kw-bar-info"><span class="kw-bar-pill" id="kw-bar-n">0</span> <span id="kw-bar-label">keyword changes</span></span>
                <button type="button" class="btn small" data-kw-bar="discard">Discard</button>
                <button type="button" class="btn small primary" data-kw-bar="save" id="kw-bar-save">Review &amp; save</button>
            </div>`;
        $('keywordsView').appendChild(bar);
        return bar;
    }

    function renderSaveBar() {
        const bar = ensureSaveBar();
        const n = st.edits.size;
        const sel = st.selected.size;
        $('kw-bar-n').textContent = fmtNum(n);
        $('kw-bar-label').textContent = n === 1 ? 'keyword change' : 'keyword changes';
        $('kw-bar-sel-n').textContent = fmtNum(sel);
        $('kw-bar-edits').hidden = !n;
        $('kw-bar-sel').hidden = !sel;
        $('kw-bar-save').disabled = st.saving;
        $('kw-bar-save').textContent = st.saving ? 'Saving…' : 'Review & save';
        $('keywordsView').classList.toggle('kw-has-bar', !!(n || sel));
        bar.classList.toggle('kw-bar-show', !!(n || sel));
        const all = $('kw-sel-all');
        if (all) {
            const pageIds = [...document.querySelectorAll('#kw-tbody input[data-kw-sel]')].map(i => +i.dataset.kwSel);
            const on = pageIds.filter(id => st.selected.has(id)).length;
            all.checked = !!pageIds.length && on === pageIds.length;
            all.indeterminate = on > 0 && on < pageIds.length;
        }
    }

    async function discardEdits() {
        const n = st.edits.size;
        if (!n) return;
        const ok = await confirmDialog({
            title: `Discard ${pluralize(n, 'keyword change')}?`,
            message: 'The staged focus keywords go back to what is stored. Nothing is written.',
            okLabel: 'Discard', tone: 'danger', writes: false,
        });
        if (!ok) return;
        st.edits.clear();
        st.editing.clear();
        st.drafts.clear();
        st.eff = null;
        render();
    }

    async function reviewAndSave() {
        if (st.saving || !st.edits.size) return;
        if (pendingDrafts()) {
            const go = await confirmDialog({
                title: 'Some keyword inputs are still open',
                message: 'Text typed in an open input is only staged when you press Enter, so it will not be saved. Continue with the staged changes only?',
                okLabel: 'Continue', writes: false,
            });
            if (!go) return;
        }
        const list = [...st.edits].map(([id, e]) => ({ id, ...e }));
        list.sort((a, b) => collator.compare(a.title, b.title));
        const stillDup = list.filter(e => e.value && othersUsing(e.id, e.value).length).length;
        const live = isLiveSite();
        const ok = await confirmDialog({
            title: `Save ${pluralize(list.length, 'focus keyword change')}?`,
            message: (live ? 'This is a LIVE site. ' : '') +
                'Each post\'s Yoast focus keyword is replaced (empty = removed) and its last-modified date is bumped. ' +
                'If any of these posts\' keywords changed elsewhere since you loaded them, nothing is saved.' +
                (stillDup ? ` Note: ${pluralize(stillDup, 'new keyword')} still ${stillDup === 1 ? 'matches' : 'match'} another post.` : ''),
            changes: list.map(e => ({
                post: `#${e.id} · ${e.title}`,
                from: e.expected || '(no keyword)',
                to: e.value,
                toLabel: 'keyword removed',
            })),
            okLabel: `Save ${pluralize(list.length, 'change')}`,
            tone: live ? 'danger' : 'primary',
        });
        if (!ok) return;
        await save(list);
    }

    async function save(list) {
        st.saving = true;
        renderSaveBar();
        let json;
        try {
            json = await api('kw_save.php', {
                method: 'POST',
                body: JSON.stringify({ changes: list.map(e => ({ post_id: e.id, focus_keyword: e.value, expected: e.expected })) }),
            });
        } catch (err) {
            console.error(err);
            json = { success: false, msg: 'Network error — nothing was saved' };
        }
        st.saving = false;

        if (json && json.success) {
            // Everything sent is done (no-ops included); anything staged meanwhile stays.
            list.forEach(e => { const cur = st.edits.get(e.id); if (cur && cur.value === e.value) st.edits.delete(e.id); });
            st.eff = null;
            toast(json.msg || 'Saved', 'ok');
            if (typeof onPostsChanged === 'function') onPostsChanged();
            await loadRows(); // fresh duplicate flags, stats and conflicting-keyword panel
            return;
        }

        const errors = (json && json.errors) || [];
        renderSaveBar();
        if (!errors.length) {
            toast((json && json.msg) || 'Save failed — nothing was written', 'err', 6000);
            return;
        }
        // The rejected edits were made against stale values: drop them and reload so the
        // current keywords show. The other staged edits stay for another save.
        const lines = errors.map(er => {
            const id = +er.post_id;
            const e = st.edits.get(id);
            if (er.status === 'conflict' || er.status === 'not_found') st.edits.delete(id);
            return `#${id} ${e ? e.title : ''}: ${er.message || er.status}` +
                (er.current !== undefined ? ` (now: ${er.current || 'no keyword'})` : '');
        });
        st.eff = null;
        await loadRows();
        await alertDialog(
            'Nothing was saved',
            `${pluralize(errors.length, 'post')} could not be saved (changed elsewhere since you loaded them, or not found). ` +
            'Those edits were dropped and the list was reloaded — re-check them.' +
            (st.edits.size ? ` Your other ${pluralize(st.edits.size, 'change')} are still staged — save again.` : ''),
            lines
        );
    }


    function renderBody() {
        clampPage();
        const cols = visibleCols();
        const total = st.view.length;
        const pages = Math.max(1, Math.ceil(total / st.pageLen));
        const start = (st.page - 1) * st.pageLen;
        const pageRows = st.view.slice(start, start + st.pageLen);

        const tbody = $('kw-tbody');
        if (!pageRows.length) {
            const msg = !st.rows.length
                ? (st.onlyDup ? 'No duplicate focus keywords in this post type / status.' : 'No posts found for this post type / status.')
                : 'No posts match the current filters.';
            tbody.innerHTML = `<tr><td colspan="${cols.length}"><div class="state-msg">${msg}</div></td></tr>`;
        } else {
            tbody.innerHTML = pageRows.map(r => {
                const cls = ((r.group ? `kw-grp kw-g${r.group}` : '') + (st.edits.has(r.id) ? ' kw-changed' : '') +
                    (st.selected.has(r.id) ? ' kw-selected' : '')).trim();
                return `<tr${cls ? ` class="${cls}"` : ''}>${cols.map(c => cellHtml(c.key, r)).join('')}</tr>`;
            }).join('');
        }

        $('kw-st-shown').textContent = fmtNum(total);
        $('kw-st-total').textContent = fmtNum(st.rows.length);
        $('kw-pg-info').textContent = total
            ? `${fmtNum(start + 1)}–${fmtNum(start + pageRows.length)} of ${pluralize(total, 'post')}` +
              (total !== st.rows.length ? ` (filtered from ${fmtNum(st.rows.length)})` : '')
            : (st.rows.length ? `No matches (filtered from ${fmtNum(st.rows.length)})` : 'No posts');
        $('kw-pg-cur').textContent = fmtNum(st.page);
        $('kw-pg-total').textContent = fmtNum(pages);
        document.querySelectorAll('#keywordsView [data-kw-page]').forEach(b => {
            const p = b.dataset.kwPage;
            b.disabled = (p === 'first' || p === 'prev') ? st.page <= 1 : st.page >= pages;
        });
    }

    function goPage(where) {
        const pages = Math.max(1, Math.ceil(st.view.length / st.pageLen));
        const target = { first: 1, prev: st.page - 1, next: st.page + 1, last: pages }[where];
        if (target === undefined || target < 1 || target > pages || target === st.page) return false;
        st.page = target;
        renderBody();
        renderSaveBar();
        const wrap = document.querySelector('#keywordsView .table-wrap');
        if (wrap) wrap.scrollTop = 0;
        return true;
    }

    function renderColsMenu() {
        $('kw-cols-list').innerHTML = COLS.filter(c => !c.noMenu).map(c => `
            <label class="col-check kw-col-check${c.locked ? ' kw-locked' : ''}">
                <input type="checkbox" data-kw-col="${c.key}" ${st.hidden.has(c.key) ? '' : 'checked'} ${c.locked ? 'disabled' : ''}>
                ${escapeHtml(c.label)}
            </label>`).join('');
    }

    /* ---------- conflicting keyword panel ---------- */
    function renderPanel() {
        const groups = new Map();
        st.rows.forEach(r => {
            if (!r.duplicate || !r.focus_keyword) return;
            if (!groups.has(r.kw_key)) groups.set(r.kw_key, { key: r.kw_key, label: r.focus_keyword.trim(), n: 0 });
            groups.get(r.kw_key).n++;
        });
        const list = [...groups.values()].sort((a, b) => b.n - a.n || collator.compare(a.label, b.label));
        $('kw-panel-hint').textContent = list.length
            ? `${pluralize(list.length, 'keyword')} used more than once — click one to isolate it`
            : 'No duplicate keywords in the current result set';
        $('kw-panel-body').innerHTML = list.length
            ? list.map(g => `<span class="kw-group-wrap"><button type="button" class="kw-group${st.kwKey === g.key ? ' active' : ''}" data-kw-key="${escapeHtml(g.key)}" data-kw-label="${escapeHtml(g.label)}" data-kw-from="panel" title="Show the ${g.n} posts using this keyword">
                    <span class="kw-group-label">${escapeHtml(g.label)}</span><span class="kw-group-count">${g.n}</span></button><button type="button" class="kw-group-edit" data-kw-edit-group="${escapeHtml(g.key)}" data-kw-label="${escapeHtml(g.label)}" title="Open these ${g.n} posts with their keyword inputs, to rename all but one">${EDIT_ICON}<span>Edit group</span></button></span>`).join('')
            : '<div class="empty-state">Nothing to resolve here.</div>';
    }

    function togglePanel(force) {
        st.panelOpen = force === undefined ? !st.panelOpen : !!force;
        $('kw-panel').hidden = !st.panelOpen;
        if (st.panelOpen) {
            renderPanel();
            $('kw-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        renderStatCards();
    }

    /* ---------- menus ---------- */
    function onDocClick(e) {
        if (e.target.closest && e.target.closest('#keywordsView .kw-menu-wrap')) return;
        closeMenus();
    }

    function closeMenus() {
        if (!openMenuId) return;
        const menu = $(openMenuId);
        if (menu) menu.classList.remove('open');
        document.querySelectorAll('#keywordsView [data-kw-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        openMenuId = '';
        document.removeEventListener('click', onDocClick);
    }

    function toggleMenu(id, btn) {
        const wasOpen = openMenuId === id;
        closeMenus();
        if (wasOpen) return;
        if (id === 'kw-cols-menu') renderColsMenu();
        $(id).classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        openMenuId = id;
        document.addEventListener('click', onDocClick);
    }

    /* ══════════════════════════ Export / copy ══════════════════════════ */

    function csvCell(v) {
        let s = v === null || v === undefined ? '' : String(v);
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // never run as a spreadsheet formula
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function rowsToCsv(rows) {
        const lines = [CSV_HEAD.join(',')];
        rows.forEach(r => {
            lines.push([
                r.no, r.id, r.url, r.title, r.slug, r.categories, r.post_status,
                fmtDate(r.post_date), fmtDate(r.post_modified), r.focus_keyword, r.duplicate ? 'yes' : 'no',
            ].map(csvCell).join(','));
        });
        return lines.join('\n') + '\n';
    }

    function downloadCsv(csv, filename) {
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function runExport(kind) {
        closeMenus();
        if (kind === 'visible') {
            if (!st.view.length) return toast('No rows to export', 'warn');
            downloadCsv(rowsToCsv(st.view), siteFile('visible'));
            return toast(`Exported ${pluralize(st.view.length, 'row')}`, 'ok');
        }
        if (kind === 'dups') {
            const rows = st.rows.filter(r => r.duplicate);
            if (!rows.length) return toast('No duplicate rows found', 'warn');
            downloadCsv(rowsToCsv(rows), siteFile('duplicates'));
            return toast(`Exported ${pluralize(rows.length, 'duplicate row')}`, 'ok');
        }
        if (kind === 'grouped') {
            const rows = st.rows.filter(r => r.duplicate && r.focus_keyword);
            if (!rows.length) return toast('No duplicate rows found', 'warn');
            rows.sort((a, b) => (a.kw_key < b.kw_key ? -1 : a.kw_key > b.kw_key ? 1 : a.id - b.id));
            downloadCsv(rowsToCsv(rows), siteFile('grouped-duplicates'));
            return toast(`Exported ${pluralize(rows.length, 'grouped row')}`, 'ok');
        }
        if (kind === 'urls') {
            const urls = st.view.map(r => r.url).filter(Boolean);
            if (!urls.length) return toast('No URLs to copy', 'warn');
            const ok = await copyToClipboard(urls.join('\n'));
            return toast(ok ? `Copied ${pluralize(urls.length, 'URL')}` : 'Copy failed — clipboard blocked', ok ? 'ok' : 'err');
        }
        if (kind === 'ids') {
            const ids = st.view.map(r => r.id);
            if (!ids.length) return toast('No IDs to copy', 'warn');
            const ok = await copyToClipboard(ids.join(', '));
            return toast(ok ? `Copied ${pluralize(ids.length, 'ID')}` : 'Copy failed — clipboard blocked', ok ? 'ok' : 'err');
        }
    }

    /* ══════════════════════════ Binding ══════════════════════════ */

    function onStatClick(stat) {
        switch (stat) {
            case 'all':
                if (st.onlyDup) setOnlyDup(false);
                clearAllFilters();
                toast('Filters cleared', '', 1600);
                break;
            case 'with':
            case 'without':
                setPresence(stat);
                break;
            case 'dup':
                setOnlyDup(!st.onlyDup);
                break;
            case 'uniq':
                togglePanel();
                break;
        }
    }

    function bindKeywordsTab() {
        const view = $('keywordsView');
        if (!view) return;

        // Per-browser prefs that don't depend on the site.
        const len = parseInt(prefGet('pageLen', '100'), 10);
        st.pageLen = PAGE_LENS.includes(len) ? len : 100;
        $('kw-page-len').value = String(st.pageLen);
        try {
            const hidden = JSON.parse(prefGet('hiddenCols', '[]'));
            if (Array.isArray(hidden)) hidden.forEach(k => { if (COLS.some(c => c.key === k && !c.locked)) st.hidden.add(k); });
        } catch (e) { /* corrupt pref */ }
        st.onlyDup = prefGet('onlyDup', '0') === '1';
        $('kw-only-dup').checked = st.onlyDup;
        renderHead();

        view.addEventListener('click', e => {
            const t = e.target;
            let el;
            if ((el = t.closest('[data-kw-menu]'))) { e.preventDefault(); toggleMenu(el.dataset.kwMenu, el); return; }
            if ((el = t.closest('[data-kw-export]'))) { runExport(el.dataset.kwExport); return; }
            if ((el = t.closest('.kw-stat'))) { onStatClick(el.dataset.kwStat); return; }
            if ((el = t.closest('[data-kw-page]'))) { goPage(el.dataset.kwPage); return; }
            if ((el = t.closest('th[data-kw-sort]'))) {
                const key = el.dataset.kwSort;
                if (st.sortKey !== key) { st.sortKey = key; st.sortDir = 1; }
                else if (st.sortDir === 1) st.sortDir = -1;
                else st.sortKey = ''; // third click: back to the server order (keyword, then last modified)
                st.page = 1;
                render();
                return;
            }
            if ((el = t.closest('[data-kw-bar]'))) {
                const a = el.dataset.kwBar;
                if (a === 'save') reviewAndSave();
                else if (a === 'discard') discardEdits();
                else if (a === 'clear-kw') clearSelected();
                else if (a === 'unselect') { st.selected.clear(); renderBody(); renderSaveBar(); }
                return;
            }
            if ((el = t.closest('[data-kw-edit-group]'))) { editGroup(el.dataset.kwEditGroup, el.dataset.kwLabel); return; }
            if ((el = t.closest('[data-kw-edit]'))) { openEdit([+el.dataset.kwEdit]); return; }
            if ((el = t.closest('[data-kw-revert]'))) { revertEdit(+el.dataset.kwRevert); return; }
            if ((el = t.closest('[data-kw-cat]'))) { setCategory(el.dataset.kwCat); return; }
            if ((el = t.closest('[data-kw-key]'))) {
                const selected = setKeyword(el.dataset.kwKey, el.dataset.kwLabel);
                if (selected && el.dataset.kwFrom === 'panel') $('kw-table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if ((el = t.closest('[data-kw-clear]'))) {
                const what = el.dataset.kwClear;
                if (what === 'all') { clearAllFilters(); return; }
                if (what === 'cat') st.cat = '';
                if (what === 'kw') { st.kwKey = ''; st.kwLabel = ''; }
                if (what === 'presence') st.presence = '';
                st.page = 1;
                syncCategorySelect();
                render();
                return;
            }
            if (t.closest('[data-kw-action="close-panel"]')) { togglePanel(false); return; }
            if (t.closest('#kw-refresh')) { loadKeywords(); }
        });

        // Keyboard access for the menu items (div role=button).
        view.addEventListener('keydown', e => {
            const input = e.target.closest && e.target.closest('input[data-kw-input]');
            if (input && !e.isComposing) {
                const id = +input.dataset.kwInput;
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(id); return; }
                if (e.key === 'Escape') { e.preventDefault(); closeEdit(id); return; }
                return;
            }
            const item = e.target.closest && e.target.closest('[data-kw-export]');
            if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); runExport(item.dataset.kwExport); }
        });

        view.addEventListener('change', e => {
            const t = e.target;
            if (t.id === 'kw-post-type') {
                st.postType = t.value;
                prefSet(sitePref('postType'), st.postType);
                resetForNewSet();
                loadRows();
            } else if (t.id === 'kw-status') {
                st.status = t.value;
                prefSet(sitePref('status'), st.status);
                if (renderTypeOptions()) prefSet(sitePref('postType'), st.postType);
                resetForNewSet();
                loadRows();
            } else if (t.id === 'kw-category') {
                st.cat = t.value;
                st.page = 1;
                render();
            } else if (t.id === 'kw-only-dup') {
                setOnlyDup(t.checked);
            } else if (t.id === 'kw-page-len') {
                const n = parseInt(t.value, 10);
                st.pageLen = PAGE_LENS.includes(n) ? n : 100;
                prefSet('pageLen', st.pageLen);
                st.page = 1;
                renderBody();
            } else if (t.matches('input[data-kw-sel]')) {
                const id = +t.dataset.kwSel;
                if (t.checked) st.selected.add(id); else st.selected.delete(id);
                t.closest('tr').classList.toggle('kw-selected', t.checked);
                renderSaveBar();
            } else if (t.id === 'kw-sel-all') {
                document.querySelectorAll('#kw-tbody input[data-kw-sel]').forEach(cb => {
                    const id = +cb.dataset.kwSel;
                    cb.checked = t.checked;
                    if (t.checked) st.selected.add(id); else st.selected.delete(id);
                    cb.closest('tr').classList.toggle('kw-selected', t.checked);
                });
                renderSaveBar();
            } else if (t.matches('input[data-kw-col]')) {
                const key = t.dataset.kwCol;
                if (COLS.some(c => c.key === key && c.locked)) return;
                if (t.checked) st.hidden.delete(key); else st.hidden.add(key);
                prefSet('hiddenCols', JSON.stringify([...st.hidden]));
                renderHead();
                renderBody();
            }
        });

        const onSearch = debounce(value => {
            st.search = value.trim();
            st.page = 1;
            render();
        }, 150);
        $('kw-search').addEventListener('input', e => onSearch(e.target.value));

        // Keyword inputs: remember the draft (survives re-renders) and update the live hint.
        $('kw-tbody').addEventListener('input', e => {
            const input = e.target.closest('input[data-kw-input]');
            if (!input) return;
            const id = +input.dataset.kwInput;
            st.drafts.set(id, input.value);
            const r = rowById(id);
            const hint = document.querySelector(`#kw-tbody [data-kw-hint="${id}"]`);
            if (r && hint) hint.innerHTML = hintHtml(r, input.value);
        });
    }

    /* ══════════════════════════ Keyboard ══════════════════════════
     * Called by app.js for every keydown while this tab is shown. Never
     * claims the global keys (/ ? g h), and skips the key that follows a
     * "g" so tab switching (g then r/d/k...) never also fires here. */
    function kwHandleKey(e) {
        if (e.defaultPrevented) return false;
        const t = e.target || {};
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t.isContentEditable;
        const dialogOpen = !!document.querySelector('.fx-modal-overlay.open, .modal-backdrop.open, body.drawer-open');

        if (e.key === 'Escape') {
            if (openMenuId) { closeMenus(); return true; }
            if (dialogOpen) return false;
            if (st.editing.size) { closeAllEdits(); return true; } // an open keyword edit goes first
            if (t.id === 'kw-search') {
                if (t.value || st.search) { t.value = ''; st.search = ''; st.page = 1; render(); }
                t.blur();
                return true;
            }
            if (typing) return false;
            if (hasFilters()) { clearAllFilters(); toast('Filters cleared', '', 1600); return true; }
            if (st.panelOpen) { togglePanel(false); return true; }
            return false;
        }

        if (dialogOpen) return false;
        // Ctrl/Cmd+K belongs to the global command palette; '/' (search) is global too.
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;

        const k = e.key;
        if (k === 'g' || k === 'G') { gAt = Date.now(); return false; }
        if (Date.now() - gAt < 1200) { gAt = 0; return false; }
        if (k === '/' || k === '?' || k === 'h' || k === 'H') return false;

        switch (k) {
            case 'ArrowLeft': return goPage('prev');
            case 'ArrowRight': return goPage('next');
            case 'r': loadKeywords(); return true;
            case 'd': setOnlyDup(!st.onlyDup); return true;
            case 'k': togglePanel(); return true;
        }
        return false;
    }

    function kwHasUnsaved() {
        return st.edits.size > 0 || pendingDrafts() > 0;
    }

    window.bindKeywordsTab = bindKeywordsTab;
    window.loadKeywords = loadKeywords;
    window.kwHandleKey = kwHandleKey;
    window.kwHasUnsaved = kwHasUnsaved;
})();
