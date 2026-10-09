// ---------------------------------------------------------------------
// Post Revisions Cleaner - front end
// Talks to api.php:  GET ?action=meta   site overview (totals, types, statuses)
//                    GET (list)         revisions grouped by parent post
//                    POST action=delete_revisions, ids[]
// Every request carries the selected site ("db") explicitly - the API never
// falls back to the shared "db" cookie other tools set.
// ---------------------------------------------------------------------

const SITES = { landing: 'Healthray', botphonic: 'Botphonic' };
const DEFAULTS = { pt: 'all', status: 'all', q: '', sort: 'revs', only_old: false, page: 1, per_page: 25 };
const TYPE_LABELS = {
    post: 'Posts', page: 'Pages', alternatives: 'Alternatives', 'case-studies': 'Case studies',
    whitepaper: 'Whitepapers', elementor_library: 'Elementor templates', wp_block: 'Reusable blocks',
    '(missing)': 'Deleted parent',
};
const MAX_BAR = 30;
const TYPE_TO_CONFIRM_AT = 50; // deleting this many or more asks to type the site name

const state = { db: 'landing', ...DEFAULTS };
let meta = null;                 // last ?action=meta response for state.db
let groups = [];                 // current page of groups
let totalGroups = 0, totalPages = 1;
const selected = new Map();      // revision_id -> { postId }
const openGroups = new Set();    // post ids expanded - survives reloads
let listReq = 0, metaReq = 0;
let pendingDelete = [];
let searchTimer = null;

const $ = id => document.getElementById(id);

// =====================================================================
// Init
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    readUrl();
    bindUi();
    applySite();
    loadMeta();
    loadList();
});

function readUrl() {
    const p = new URLSearchParams(location.search);
    let db = p.get('db');
    if (!SITES[db]) {
        try { db = localStorage.getItem('verDb'); } catch (e) { db = null; }
    }
    state.db = SITES[db] ? db : 'landing';
    state.pt = p.get('pt') || DEFAULTS.pt;
    state.status = p.get('status') || DEFAULTS.status;
    state.q = p.get('q') || '';
    state.sort = p.get('sort') || DEFAULTS.sort;
    state.only_old = p.get('only_old') === '1';
    state.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
    state.per_page = [25, 50, 100].includes(+p.get('per_page')) ? +p.get('per_page') : DEFAULTS.per_page;

    $('searchInput').value = state.q;
    $('sortSelect').value = state.sort;
    $('onlyOldToggle').checked = state.only_old;
}

// Keep the address bar in sync so a refresh or a shared link opens the same view
function writeUrl() {
    const p = new URLSearchParams({ db: state.db });
    Object.keys(DEFAULTS).forEach(k => {
        const v = state[k];
        if (v === DEFAULTS[k]) return;
        p.set(k, typeof v === 'boolean' ? '1' : v);
    });
    history.replaceState(null, '', '?' + p.toString());
}

function bindUi() {
    // Site switch
    $('siteSwitch').addEventListener('click', e => {
        const btn = e.target.closest('.site-btn');
        if (!btn || btn.dataset.db === state.db) return;
        switchSite(btn.dataset.db);
    });

    // Search (debounced)
    $('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => setFilter({ q: $('searchInput').value.trim() }), 350);
    });
    $('statusSelect').addEventListener('change', e => setFilter({ status: e.target.value }));
    $('sortSelect').addEventListener('change', e => setFilter({ sort: e.target.value }));
    $('onlyOldToggle').addEventListener('change', e => setFilter({ only_old: e.target.checked }));
    $('statOldCard').addEventListener('click', () => setFilter({ only_old: !state.only_old }));
    $('resetBtn').addEventListener('click', resetFilters);

    $('typeChips').addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip) setFilter({ pt: chip.dataset.pt });
    });

    // Results actions
    $('selectPageOldBtn').addEventListener('click', toggleSelectPageOld);
    $('expandAllBtn').addEventListener('click', () => setAllOpen(true));
    $('collapseAllBtn').addEventListener('click', () => setAllOpen(false));
    $('reloadBtn').addEventListener('click', () => { loadMeta(); loadList(); });

    // List (event delegation)
    $('list').addEventListener('click', onListClick);
    $('list').addEventListener('change', onListChange);

    // Selection bar
    $('clearSelBtn').addEventListener('click', clearSelection);
    $('deleteSelBtn').addEventListener('click', () => openConfirm([...selected.keys()]));

    // Modals
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => {
            if (e.target === m || e.target.closest('[data-close]')) closeModal(m);
        });
    });
    $('confirmDeleteBtn').addEventListener('click', doDelete);
    $('helpBtn').addEventListener('click', () => openModal($('helpModal')));

    // Theme
    $('themeToggle').addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
        const next = dark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('verTheme', next); } catch (e) { }
    });

    document.addEventListener('keydown', onKey);
}

// =====================================================================
// Site + filters
// =====================================================================
function applySite() {
    document.documentElement.setAttribute('data-site', state.db);
    document.querySelectorAll('.site-btn').forEach(b => {
        const on = b.dataset.db === state.db;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.title = `Post Revisions · ${SITES[state.db]}`;
    try { localStorage.setItem('verDb', state.db); } catch (e) { }
}

function switchSite(db) {
    state.db = db;
    Object.assign(state, { pt: 'all', status: 'all', q: '', page: 1 });
    $('searchInput').value = '';
    meta = null;
    groups = [];        // never show one site's posts with the other site's links/stats
    clearSelection();
    openGroups.clear();
    applySite();
    loadMeta();
    loadList();
}

function setFilter(changes) {
    Object.assign(state, changes, { page: changes.page || 1 });
    $('onlyOldToggle').checked = state.only_old;
    clearSelection();
    renderFilterUi();
    loadList();
}

function resetFilters() {
    Object.assign(state, DEFAULTS);
    $('searchInput').value = '';
    $('sortSelect').value = DEFAULTS.sort;
    $('onlyOldToggle').checked = false;
    clearSelection();
    renderFilterUi();
    loadList();
}

// =====================================================================
// Data
// =====================================================================
async function api(params, options) {
    const url = 'api.php?' + new URLSearchParams({ db: state.db, ...params }).toString();
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`Server error (HTTP ${res.status})`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Request failed');
    return json;
}

async function loadMeta() {
    const id = ++metaReq;
    document.querySelectorAll('.stat').forEach(s => s.classList.add('loading'));
    try {
        const json = await api({ action: 'meta' });
        if (id !== metaReq || json.db !== state.db) return;
        meta = json;
        renderStats();
        renderFilterUi();
        const admin = $('adminLink');
        admin.hidden = !meta.admin_url;
        admin.href = meta.admin_url || '#';
        admin.title = `Open ${meta.label} WordPress admin`;
        if (groups.length) renderList();   // list may have arrived first - add the edit / compare links now
    } catch (err) {
        if (id === metaReq) toast(`Could not load site overview: ${err.message}`, 'error');
    } finally {
        if (id === metaReq) document.querySelectorAll('.stat').forEach(s => s.classList.remove('loading'));
    }
}

async function loadList() {
    const id = ++listReq;
    writeUrl();
    $('list').innerHTML = '<div class="skeleton"></div>'.repeat(5);
    $('resultsInfo').innerHTML = `<span class="spin"></span>&nbsp; Loading ${esc(SITES[state.db])} revisions…`;
    $('pagination').innerHTML = '';

    const params = { sort: state.sort, page: state.page, per_page: state.per_page };
    if (state.pt !== 'all') params.pt = state.pt;
    if (state.status !== 'all') params.status = state.status;
    if (state.q) params.q = state.q;
    if (state.only_old) params.only_old = 1;

    try {
        const json = await api(params);
        if (id !== listReq || json.db !== state.db) return;   // a newer request / site switch won
        groups = json.groups;
        totalGroups = json.totalGroups;
        totalPages = json.totalPages;
        if (state.page > totalPages && totalGroups > 0) { state.page = totalPages; loadList(); return; }
        renderList();
        renderPagination();
    } catch (err) {
        if (id !== listReq) return;
        groups = [];
        $('resultsInfo').textContent = 'Could not load revisions';
        $('list').innerHTML = `
            <div class="empty error">
                <i class="bi bi-wifi-off"></i>
                <h3>Could not load revisions</h3>
                <p>${esc(err.message)}</p>
                <button type="button" class="btn btn-ghost" onclick="loadList()"><i class="bi bi-arrow-clockwise"></i>Try again</button>
            </div>`;
    }
}

// =====================================================================
// Rendering - stats + filters
// =====================================================================
function renderStats() {
    const t = meta.totals;
    $('statPosts').textContent = fmtNum(t.posts);
    $('statRevs').textContent = fmtNum(t.revisions);
    $('statMeta').textContent = fmtNum(t.meta_rows);
    $('statSize').textContent = fmtBytes(t.bytes);
    const old = $('statOld');
    old.textContent = fmtNum(t.deletable);
    old.className = 'stat-value ' + (t.deletable > 0 ? 'warn' : 'ok');
    $('statOldHint').innerHTML = t.deletable > 0
        ? (state.only_old ? 'Showing these posts <i class="bi bi-check2"></i>' : 'Show these posts <i class="bi bi-arrow-right"></i>')
        : 'Nothing to clean <i class="bi bi-check2-circle"></i>';
}

function renderFilterUi() {
    $('statOldCard').classList.toggle('active', state.only_old);
    if (meta) renderStats();
    if (!meta) return;

    // Post type chips - only the types that actually have revisions on this site
    const types = meta.types;
    if (state.pt !== 'all' && !types.some(t => t.key === state.pt)) state.pt = 'all';
    const all = types.reduce((s, t) => s + t.posts, 0);
    $('typeChips').innerHTML =
        chipHtml('all', 'All', all, 1) +
        types.map((t, i) => chipHtml(t.key, TYPE_LABELS[t.key] || t.key, t.posts, i + 2)).join('');

    // Status options
    const sel = $('statusSelect');
    if (state.status !== 'all' && !meta.statuses.some(s => s.key === state.status)) state.status = 'all';
    sel.innerHTML = '<option value="all">All</option>' + meta.statuses
        .map(s => `<option value="${esc(s.key)}">${esc(cap(s.key))} (${fmtNum(s.posts)})</option>`).join('');
    sel.value = state.status;
}

function chipHtml(key, label, n, idx) {
    const hint = idx <= 9 ? ` (${idx})` : '';
    return `<button type="button" class="chip ${state.pt === key ? 'active' : ''}" data-pt="${esc(key)}" role="tab"
                aria-selected="${state.pt === key}" title="${esc(label)}${hint}">${esc(label)} <span class="n">${fmtNum(n)}</span></button>`;
}

// =====================================================================
// Rendering - list
// =====================================================================
function keepCount() { return meta ? meta.keep : 5; }

function renderList() {
    const from = totalGroups ? (state.page - 1) * state.per_page + 1 : 0;
    const to = Math.min(totalGroups, from + groups.length - 1);
    const pageOld = groups.reduce((s, g) => s + oldRevs(g).length, 0);
    $('resultsInfo').innerHTML = totalGroups
        ? `Showing <strong>${from}–${to}</strong> of <strong>${fmtNum(totalGroups)}</strong> posts · <strong>${fmtNum(pageOld)}</strong> old revision${pageOld === 1 ? '' : 's'} on this page`
        : 'No posts found';

    if (!groups.length) {
        const filtered = state.q || state.pt !== 'all' || state.status !== 'all';
        $('list').innerHTML = state.only_old && !filtered
            ? `<div class="empty"><i class="bi bi-check2-circle"></i><h3>Nothing to clean on ${esc(SITES[state.db])}</h3>
                 <p>Every post has ${keepCount()} revisions or fewer.</p>
                 <button type="button" class="btn btn-ghost" onclick="setFilter({only_old:false})">Show all posts</button></div>`
            : `<div class="empty"><i class="bi bi-search"></i><h3>No posts match these filters</h3>
                 <p>Try a different search, type or status.</p>
                 <button type="button" class="btn btn-ghost" onclick="resetFilters()"><i class="bi bi-arrow-counterclockwise"></i>Reset filters</button></div>`;
        updateSelectionUi();
        return;
    }

    $('list').innerHTML = groups.map(groupHtml).join('');
    refreshAllGroups();
    updateSelectionUi();
}

function oldRevs(g) { return g.revisions.slice(keepCount()); }

function groupHtml(g) {
    const old = oldRevs(g);
    const title = g.post_title || g.post_name || '(no title)';
    const editUrl = meta && meta.admin_url ? `${meta.admin_url}post.php?post=${g.post_id}&action=edit` : '';
    const open = openGroups.has(g.post_id);

    return `
    <article class="group ${open ? 'open' : ''}" data-post="${g.post_id}">
        <div class="group-head" data-toggle>
            <input type="checkbox" class="check g-check" ${old.length ? '' : 'disabled'}
                   title="${old.length ? `Select the ${old.length} old revision(s) of this post` : `Nothing to delete - only the latest ${keepCount()} exist`}"
                   aria-label="Select old revisions of ${esc(title)}">
            <div class="g-main">
                <div class="g-title">
                    <strong title="${esc(title)}">${esc(title)}</strong>
                    ${editUrl ? `<a href="${esc(editUrl)}" target="_blank" rel="noopener" title="Edit in WordPress" data-stop><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
                </div>
                <div class="g-sub">
                    <span class="mono">#${g.post_id}</span>
                    <span class="badge">${esc(TYPE_LABELS[g.post_type] ? singular(g.post_type) : (g.post_type || 'unknown'))}</span>
                    <span class="badge st-${esc(g.post_status || '')}">${esc(cap(g.post_status || 'missing'))}</span>
                    ${g.post_name ? `<span class="slug" title="${esc(g.post_name)}">/${esc(g.post_name)}</span>` : ''}
                </div>
                ${barHtml(g)}
            </div>
            <div class="g-nums">
                <span class="num"><b>${g.revision_count}</b><small>revisions</small></span>
                <span class="num ${old.length ? 'old' : 'zero'}"><b>${old.length}</b><small>old</small></span>
                <span class="num"><b>${fmtNum(g.total_meta)}</b><small>meta</small></span>
                <span class="num"><b>${fmtBytes(g.total_bytes)}</b><small>size</small></span>
            </div>
            <div class="g-act">
                <span class="when" title="Last revision ${esc(g.last_revision || '')}">${esc(relTime(g.last_revision))}</span>
                ${old.length ? `<button type="button" class="btn btn-warn btn-sm" data-trim title="Delete the ${old.length} old revision(s), keep the latest ${keepCount()}">
                    <i class="bi bi-scissors"></i>Trim to ${keepCount()}</button>` : ''}
            </div>
            <i class="bi bi-chevron-right chev" aria-hidden="true"></i>
        </div>
        <div class="g-panel">${open ? panelHtml(g) : ''}</div>
    </article>`;
}

function barHtml(g) {
    const revs = g.revisions.slice(0, MAX_BAR);
    const more = g.revisions.length - revs.length;
    return `<div class="rev-bar" title="Green = kept (latest ${keepCount()}) · grey = old · red = selected">` +
        revs.map((r, i) => `<span class="${i < keepCount() ? '' : (selected.has(r.revision_id) ? 'old sel' : 'old')}"></span>`).join('') +
        (more > 0 ? `<span class="more">+${more}</span>` : '') + '</div>';
}

function panelHtml(g) {
    const admin = meta && meta.admin_url;
    const rows = g.revisions.map((r, i) => {
        const kept = i < keepCount();
        const sel = selected.has(r.revision_id);
        const compare = admin ? `<a class="link-btn" href="${esc(admin)}revision.php?revision=${r.revision_id}" target="_blank" rel="noopener" title="Compare with the previous version in WordPress"><i class="bi bi-layout-split"></i><span class="hide-sm">Compare</span></a>` : '';
        return `
        <tr class="${kept ? 'kept' : ''} ${sel ? 'selected' : ''}" data-rev="${r.revision_id}">
            <td>${kept
                ? `<i class="bi bi-shield-lock-fill lock" title="Kept - one of the latest ${keepCount()} revisions"></i>`
                : `<input type="checkbox" class="check r-check" value="${r.revision_id}" ${sel ? 'checked' : ''} aria-label="Select revision ${r.revision_id}">`}</td>
            <td class="r-id">#${r.revision_id}</td>
            <td class="r-when"><b>${esc(relTime(r.post_date))}</b><small>${esc(r.post_date)}</small></td>
            <td class="hide-md">${esc(r.author || '–')}</td>
            <td class="hide-md">${i === 0 ? '<span class="badge latest">Latest</span> ' : ''}${r.autosave ? '<span class="badge autosave">Autosave</span>' : ''}${kept && i ? '<span class="badge">Kept</span>' : ''}</td>
            <td class="r-num">${fmtBytes(r.bytes)}</td>
            <td class="r-num hide-md">${r.meta_count}</td>
            <td class="r-act">${compare}
                ${kept ? '' : `<button type="button" class="link-btn danger" data-del="${r.revision_id}" title="Delete this revision"><i class="bi bi-trash3"></i></button>`}
            </td>
        </tr>`;
    }).join('');

    const old = oldRevs(g).length;
    return `
        <table class="rev-table">
            <thead><tr><th></th><th>Revision</th><th>Saved</th><th class="hide-md">Author</th><th class="hide-md"></th>
                <th class="r-num">Size</th><th class="r-num hide-md">Meta</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="panel-foot">
            <span><i class="bi bi-shield-check"></i> Latest ${keepCount()} kept · ${old ? `${old} old revision${old === 1 ? '' : 's'} can be deleted` : 'nothing to delete'}</span>
            ${meta && meta.home_url && g.post_status === 'publish' ? `<a href="${esc(meta.home_url)}/?p=${g.post_id}" target="_blank" rel="noopener">View live page <i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        </div>`;
}

function renderPagination() {
    const el = $('pagination');
    if (!totalGroups) { el.innerHTML = ''; return; }
    const p = state.page, n = totalPages;
    const pages = new Set([1, n, p - 1, p, p + 1].filter(x => x >= 1 && x <= n));
    const list = [...pages].sort((a, b) => a - b);
    let html = `<button class="pg" data-page="${p - 1}" ${p <= 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>`;
    list.forEach((x, i) => {
        if (i && x - list[i - 1] > 1) html += '<span class="pg-gap">…</span>';
        html += `<button class="pg ${x === p ? 'active' : ''}" data-page="${x}">${x}</button>`;
    });
    html += `<button class="pg" data-page="${p + 1}" ${p >= n ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;
    html += `<label class="select-wrap"><span>Per page</span><select id="perPageSelect">
        ${[25, 50, 100].map(v => `<option ${v === state.per_page ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
    el.innerHTML = html;
    el.querySelectorAll('.pg[data-page]').forEach(b => b.addEventListener('click', () => goPage(+b.dataset.page)));
    $('perPageSelect').addEventListener('change', e => setFilter({ per_page: +e.target.value }));
}

function goPage(p) {
    if (p < 1 || p > totalPages || p === state.page) return;
    state.page = p;
    clearSelection();
    loadList();
    window.scrollTo({ top: $('list').offsetTop - 140, behavior: 'smooth' });
}

// =====================================================================
// List interactions
// =====================================================================
function findGroup(postId) { return groups.find(g => g.post_id === postId); }

function onListClick(e) {
    const groupEl = e.target.closest('.group');
    if (!groupEl) return;
    const g = findGroup(+groupEl.dataset.post);
    if (!g) return;

    if (e.target.closest('[data-stop]') || e.target.closest('a')) return;   // links work normally
    if (e.target.closest('[data-trim]')) { openConfirm(oldRevs(g).map(r => r.revision_id)); return; }
    const del = e.target.closest('[data-del]');
    if (del) { openConfirm([+del.dataset.del]); return; }
    if (e.target.closest('.check')) return;                                // handled by change
    if (e.target.closest('[data-toggle]')) toggleGroup(groupEl, g);
}

function onListChange(e) {
    const groupEl = e.target.closest('.group');
    if (!groupEl) return;
    const g = findGroup(+groupEl.dataset.post);
    if (!g) return;

    if (e.target.classList.contains('g-check')) {
        oldRevs(g).forEach(r => e.target.checked ? selected.set(r.revision_id, { postId: g.post_id }) : selected.delete(r.revision_id));
    } else if (e.target.classList.contains('r-check')) {
        const id = +e.target.value;
        e.target.checked ? selected.set(id, { postId: g.post_id }) : selected.delete(id);
    }
    refreshGroup(groupEl, g);
    updateSelectionUi();
}

function toggleGroup(groupEl, g) {
    const open = !groupEl.classList.contains('open');
    groupEl.classList.toggle('open', open);
    if (open) {
        openGroups.add(g.post_id);
        groupEl.querySelector('.g-panel').innerHTML = panelHtml(g);
    } else {
        openGroups.delete(g.post_id);
    }
}

function setAllOpen(open) {
    document.querySelectorAll('.group').forEach(el => {
        const g = findGroup(+el.dataset.post);
        if (!g || el.classList.contains('open') === open) return;
        toggleGroup(el, g);
    });
}

// Re-sync one group's checkboxes, bar and row highlights with `selected`
function refreshGroup(groupEl, g) {
    const old = oldRevs(g);
    const n = old.filter(r => selected.has(r.revision_id)).length;
    const gc = groupEl.querySelector('.g-check');
    gc.checked = old.length > 0 && n === old.length;
    gc.indeterminate = n > 0 && n < old.length;
    groupEl.classList.toggle('has-selection', n > 0);
    groupEl.querySelector('.rev-bar').outerHTML = barHtml(g);
    groupEl.querySelectorAll('tr[data-rev]').forEach(tr => {
        const on = selected.has(+tr.dataset.rev);
        tr.classList.toggle('selected', on);
        const cb = tr.querySelector('.r-check');
        if (cb) cb.checked = on;
    });
}

function refreshAllGroups() {
    document.querySelectorAll('.group').forEach(el => {
        const g = findGroup(+el.dataset.post);
        if (g) refreshGroup(el, g);
    });
}

function toggleSelectPageOld() {
    const ids = groups.flatMap(g => oldRevs(g).map(r => [r.revision_id, g.post_id]));
    if (!ids.length) { toast('No old revisions on this page - the latest 5 of every post are kept.', 'info'); return; }
    const allOn = ids.every(([id]) => selected.has(id));
    ids.forEach(([id, postId]) => allOn ? selected.delete(id) : selected.set(id, { postId }));
    refreshAllGroups();
    updateSelectionUi();
}

function clearSelection() {
    selected.clear();
    refreshAllGroups();
    updateSelectionUi();
}

function selectionStats(ids) {
    let metaRows = 0, bytes = 0;
    const posts = new Map();
    ids.forEach(id => {
        for (const g of groups) {
            const r = g.revisions.find(x => x.revision_id === id);
            if (r) {
                metaRows += r.meta_count;
                bytes += r.bytes;
                posts.set(g.post_id, (posts.get(g.post_id) || 0) + 1);
                break;
            }
        }
    });
    return { metaRows, bytes, posts };
}

function updateSelectionUi() {
    const n = selected.size;
    const pageOld = groups.reduce((s, g) => s + oldRevs(g).length, 0);
    const btn = $('selectPageOldBtn');
    btn.disabled = pageOld === 0;
    btn.innerHTML = pageOld && groups.every(g => oldRevs(g).every(r => selected.has(r.revision_id)))
        ? '<i class="bi bi-x-square"></i>Clear selection'
        : `<i class="bi bi-check2-square"></i>Select old on this page${pageOld ? ` (${pageOld})` : ''}`;

    $('selectionBar').classList.toggle('visible', n > 0);
    if (!n) return;
    const s = selectionStats([...selected.keys()]);
    $('selCount').textContent = n;
    $('selLabel').textContent = `revision${n === 1 ? '' : 's'} selected`;
    $('selSub').textContent = `${s.posts.size} post${s.posts.size === 1 ? '' : 's'} · ${fmtNum(s.metaRows)} meta rows · ${fmtBytes(s.bytes)} · ${SITES[state.db]}`;
    $('deleteSelText').textContent = `Delete ${n}`;
}

// =====================================================================
// Delete
// =====================================================================
function openConfirm(ids) {
    if (!ids.length) return;
    pendingDelete = ids;
    const s = selectionStats(ids);
    const site = SITES[state.db];
    const host = meta && meta.home_url ? meta.home_url.replace(/^https?:\/\//, '') : '';
    const postList = [...s.posts.entries()].map(([pid, count]) => {
        const g = findGroup(pid);
        const t = g ? (g.post_title || g.post_name || '(no title)') : `#${pid}`;
        return `<li><span>${esc(t)} <span class="mono" style="color:var(--muted)">#${pid}</span></span><span>${count} revision${count === 1 ? '' : 's'}</span></li>`;
    }).join('');
    const needType = ids.length >= TYPE_TO_CONFIRM_AT;

    $('confirmTitle').textContent = `Delete ${ids.length} revision${ids.length === 1 ? '' : 's'}?`;
    $('confirmBody').innerHTML = `
        <div class="site-callout"><span class="site-dot"></span>Website: ${esc(site)}${host ? ` <span class="mono" style="font-weight:500;color:var(--muted)">(${esc(host)})</span>` : ''}</div>
        <div class="confirm-sum">
            <div><b>${ids.length}</b><small>revisions</small></div>
            <div><b>${fmtNum(s.metaRows)}</b><small>meta rows</small></div>
            <div><b>${fmtBytes(s.bytes)}</b><small>content</small></div>
        </div>
        <ul class="confirm-list">${postList}</ul>
        <div class="confirm-warn"><i class="bi bi-exclamation-octagon"></i>This permanently deletes them from the live database. It cannot be undone. The latest ${keepCount()} revisions of each post stay.</div>
        ${needType ? `<label class="confirm-type">Type <strong>${esc(site)}</strong> to confirm
            <input type="text" id="confirmTypeInput" autocomplete="off" spellcheck="false"></label>` : ''}`;

    const btn = $('confirmDeleteBtn');
    btn.querySelector('span').textContent = `Delete ${ids.length} from ${site}`;
    btn.disabled = needType;
    if (needType) {
        $('confirmTypeInput').addEventListener('input', e => {
            btn.disabled = e.target.value.trim().toLowerCase() !== site.toLowerCase();
        });
    }
    openModal($('confirmModal'));
    setTimeout(() => (needType ? $('confirmTypeInput') : $('confirmModal').querySelector('[data-close].btn')).focus(), 50);
}

async function doDelete() {
    const btn = $('confirmDeleteBtn');
    if (btn.disabled || !pendingDelete.length) return;
    btn.disabled = true;
    const label = btn.querySelector('span');
    const oldLabel = label.textContent;
    label.innerHTML = '<span class="spin"></span> Deleting…';

    const body = new FormData();
    body.append('action', 'delete_revisions');
    body.append('db', state.db);
    pendingDelete.forEach(id => body.append('ids[]', id));

    try {
        const json = await api({}, { method: 'POST', body });
        if (json.db !== state.db) throw new Error('Site mismatch - nothing was refreshed, please reload the page.');
        closeModal($('confirmModal'));
        let msg = `Deleted ${json.deleted_posts} revision${json.deleted_posts === 1 ? '' : 's'} and ${fmtNum(json.deleted_meta)} meta rows from ${SITES[state.db]}.`;
        if (json.protected_skipped) msg += ` ${json.protected_skipped} were among the latest ${keepCount()} and kept.`;
        if (json.skipped) msg += ` ${json.skipped} no longer existed.`;
        toast(msg, 'success');
        pendingDelete = [];
        selected.clear();
        loadMeta();
        loadList();
    } catch (err) {
        toast(err.message, 'error');
        label.textContent = oldLabel;
        btn.disabled = false;
        return;
    }
    label.textContent = oldLabel;
    btn.disabled = false;
}

// =====================================================================
// Modals, toasts, keyboard
// =====================================================================
function openModal(m) { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
function closeModal(m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
function anyModalOpen() { return document.querySelector('.modal.open'); }

function toast(msg, type = 'info') {
    const icon = { success: 'check-circle-fill', error: 'exclamation-circle-fill', info: 'info-circle-fill' }[type];
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="bi bi-${icon}"></i><span>${esc(msg)}</span><button type="button" aria-label="Dismiss"><i class="bi bi-x"></i></button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 9000 : 5000);
}

function onKey(e) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); $('searchInput').focus(); $('searchInput').select(); return;
    }
    if (e.key === 'Escape') {
        const m = anyModalOpen();
        if (m) { closeModal(m); return; }
        if (typing) { t.blur(); return; }
        if (selected.size) clearSelection();
        return;
    }
    if (anyModalOpen()) return;   // deleting always needs a deliberate click on the button
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    if (/^[1-9]$/.test(e.key)) {
        const chip = $('typeChips').querySelectorAll('.chip')[+e.key - 1];
        if (chip) chip.click();
        return;
    }
    switch (e.key) {
        case '/': e.preventDefault(); $('searchInput').focus(); $('searchInput').select(); break;
        case '?': openModal($('helpModal')); break;
        case 'o': case 'O': setFilter({ only_old: !state.only_old }); break;
        case 'a': case 'A': e.preventDefault(); toggleSelectPageOld(); break;
        case 'e': case 'E': setAllOpen(true); break;
        case 'c': case 'C': setAllOpen(false); break;
        case 'r': case 'R': loadMeta(); loadList(); break;
        case 'Delete': if (selected.size) openConfirm([...selected.keys()]); break;
        case 'ArrowLeft': goPage(state.page - 1); break;
        case 'ArrowRight': goPage(state.page + 1); break;
    }
}

// =====================================================================
// Helpers
// =====================================================================
function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function singular(type) {
    const l = TYPE_LABELS[type] || type;
    return l.endsWith('s') ? l.slice(0, -1) : l;
}
function fmtNum(n) { return Number(n || 0).toLocaleString('en-IN'); }
function fmtBytes(b) {
    b = Number(b || 0);
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
}
// WordPress post_date is the site's local time; good enough for "x days ago"
function relTime(s) {
    if (!s) return '–';
    const d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return s;
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return 'just now';
    const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [u, name] of units) {
        if (sec >= u) { const n = Math.floor(sec / u); return `${n} ${name}${n === 1 ? '' : 's'} ago`; }
    }
    return 'just now';
}
