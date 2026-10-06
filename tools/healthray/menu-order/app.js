/* ═══════════════════════════════════════════════════════════
   Menu Order — app.js

   · Every field is edited inline; edits are kept client-side (state.edits)
     until "Review & save", which sends one atomic batch to api.php.
   · Reordering (drag handle, ↑/↓ buttons, Alt+↑/↓) only renumbers the rows
     that actually need a new number, so a single move doesn't rewrite the
     whole table.
   · The server refuses a save for any post modified after it was loaded.
   ═══════════════════════════════════════════════════════════ */

const API = 'api.php';
const FIELDS = ['menu_order', 'title', 'slug', 'date'];
const FIELD_LABEL = { menu_order: 'Order', title: 'Title', slug: 'Slug', date: 'Published' };

const POST_TYPE_LABELS = {
    post: 'Blog Posts', page: 'Pages', whitepaper: 'Whitepapers', 'case-studies': 'Case Studies',
    jobs: 'Jobs', job: 'Jobs (draft)', events: 'Events', event: 'Events (draft)', faq: 'FAQ Entries',
    alternatives: 'Alternatives',
};

const LS = { type: 'menuOrder.type', sort: 'menuOrder.sort', theme: 'linkChecker.theme' };

const state = {
    type: 'page',
    items: [],
    byId: new Map(),
    parents: new Map(),   // id → { title, slug, parent } for parents outside the list
    edits: new Map(),     // id → { field: value } — only fields that differ from the DB
    errors: new Map(),    // id → message from the last save attempt
    sort: 'newest',
    view: 'all',          // all | ties | changed
    parentFilter: '',
    search: '',
    terms: [],
    visible: [],          // ids currently rendered, in display order
    siteUrl: '',
    dbLabel: '',
    loading: false,
    saving: false,
};

/* ── Helpers ───────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $tbody = $('tbody');
const $wrap = $('table-wrap');

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n) { return Number(n || 0).toLocaleString(); }
function plural(n, word, many = word + 's') { return `${fmt(n)} ${n === 1 ? word : many}`; }
function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function typeLabel(t) { return POST_TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : ''); }
function noun(n) {
    const label = typeLabel(state.type).toLowerCase();
    return n === 1 ? label.replace(/ies$/, 'y').replace(/s$/, '') : label;
}

/* Same rules as api.php's sanitize_slug() / WordPress for ASCII slugs. */
function sanitizeSlug(s) {
    return String(s || '').trim().toLowerCase()
        .replace(/[\s_./]+/g, '-').replace(/[^a-z0-9%-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/* DB "YYYY-MM-DD HH:MM:SS" ⇄ <input type=datetime-local step=1> value */
const toInputDate = d => String(d || '').replace(' ', 'T');
function fromInputDate(v) {
    let s = String(v || '').replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
    return s;
}

const ICON = {
    grip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
    up: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>`,
    down: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    view: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
    wp: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    revert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>`,
    sun: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
};

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, type = 'info', ms = 3600) {
    const box = $('toast');
    while (box.children.length >= 4) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast-item toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icon">${{ success: '✓', error: '!', info: 'i' }[type] || 'i'}</span>
        <span class="toast-msg"></span><button class="toast-close" aria-label="Dismiss">×</button>`;
    el.querySelector('.toast-msg').textContent = msg;
    const dismiss = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.toast-close').addEventListener('click', dismiss);
    box.appendChild(el);
    setTimeout(dismiss, type === 'error' ? Math.max(ms, 6000) : ms);
}

/* ═══════════════════════════════════════════════════════════
   Values & edits
   ═══════════════════════════════════════════════════════════ */
function item(id) { return state.byId.get(Number(id)); }

/* Current value of a field — the pending edit if there is one. */
function cur(it, field) {
    const e = state.edits.get(it.id);
    return e && field in e ? e[field] : it[field];
}
function order(id) { return Number(cur(item(id), 'menu_order')); }

function normalize(field, value) {
    if (field === 'menu_order') return /^-?\d+$/.test(String(value).trim()) ? parseInt(value, 10) : String(value);
    if (field === 'date') return fromInputDate(value);
    return String(value);
}

/* Record (or clear) one field edit. Returns true if anything changed. */
function setField(id, field, raw) {
    const it = item(id);
    if (!it) return false;
    const value = normalize(field, raw);
    const e = { ...(state.edits.get(it.id) || {}) };
    const before = JSON.stringify(e);
    if (value === it[field]) delete e[field];
    else e[field] = value;
    if (Object.keys(e).length) state.edits.set(it.id, e);
    else state.edits.delete(it.id);
    state.errors.delete(it.id);
    return JSON.stringify(e) !== before;
}

function revertRow(id) {
    state.edits.delete(Number(id));
    state.errors.delete(Number(id));
    render();
}

function fieldInvalid(it, field) {
    const v = cur(it, field);
    if (field === 'menu_order') return typeof v !== 'number';
    if (field === 'title') return !String(v).trim();
    if (field === 'slug') return !sanitizeSlug(v);
    if (field === 'date') return !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v);
    return false;
}

/* How many items (of the whole type) share each current order value. */
function tieCounts() {
    const counts = new Map();
    for (const it of state.items) {
        const o = cur(it, 'menu_order');
        counts.set(o, (counts.get(o) || 0) + 1);
    }
    return counts;
}

/* /parent-slug/child-slug/ for hierarchical pages, using pending slug edits. */
function pathFor(it) {
    const parts = [String(cur(it, 'slug'))];
    let parent = it.parent, guard = 0;
    while (parent && guard++ < 20) {
        const p = state.byId.get(parent) || state.parents.get(parent);
        if (!p) break;
        parts.unshift(state.byId.has(parent) ? String(cur(p, 'slug')) : p.slug);
        parent = p.parent;
    }
    return parts;
}

function parentTitle(id) {
    const p = state.byId.get(id) || state.parents.get(id);
    return p ? p.title : `#${id}`;
}

/* ═══════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════ */
async function api(action, opts = {}) {
    const res = await fetch(`${API}?action=${action}${opts.query || ''}`, opts.body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body),
    } : undefined);
    const data = await res.json().catch(() => ({ status: 'error', message: `Bad response (HTTP ${res.status})` }));
    return data;
}

async function loadDatabases() {
    try {
        const data = await api('databases');
        if (data.status !== 'success') return;
        $('site-select').innerHTML = data.databases.map(d =>
            `<option value="${escAttr(d.key)}"${d.key === data.current ? ' selected' : ''}>${esc(d.label)}</option>`).join('');
        state.dbLabel = data.databases.find(d => d.key === data.current)?.label || data.current;
    } catch { /* switcher is optional */ }
}

async function loadTypes() {
    try {
        const data = await api('post_types');
        if (data.status !== 'success') throw new Error(data.message);
        const types = data.post_types;
        if (!types.some(t => t.post_type === state.type)) state.type = types.some(t => t.post_type === 'page') ? 'page' : types[0]?.post_type;
        $('sel-type').innerHTML = types.map(t =>
            `<option value="${escAttr(t.post_type)}"${t.post_type === state.type ? ' selected' : ''}>${esc(typeLabel(t.post_type))} (${fmt(t.count)})</option>`).join('');
    } catch (e) {
        showToast('Could not load content types: ' + e.message, 'error');
    }
}

async function loadItems() {
    state.loading = true;
    setLoading();
    try {
        const data = await api('list', { query: `&type=${encodeURIComponent(state.type)}` });
        if (data.status !== 'success') throw new Error(data.message || 'Unknown error');
        state.items = data.items;
        state.byId = new Map(data.items.map(it => [it.id, it]));
        state.parents = new Map((data.parents || []).map(p => [p.id, p]));
        state.edits.clear();
        state.errors.clear();
        state.siteUrl = data.site_url || '';
        $('site-url').textContent = state.siteUrl.replace(/^https?:\/\//, '');
        $('site-url').href = state.siteUrl || '#';
        buildParentFilter();
        render();
    } catch (e) {
        $tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>Could not load ${esc(noun(2))}</p>
            <div class="sub">${esc(e.message)}</div><button class="btn btn-ghost btn-sm" data-act="reload">Try again</button></div></td></tr>`;
    } finally {
        state.loading = false;
    }
}

function buildParentFilter() {
    const parentIds = [...new Set(state.items.map(it => it.parent).filter(Boolean))];
    $('parent-wrap').hidden = !parentIds.length;
    if (!parentIds.length) { state.parentFilter = ''; return; }
    const opts = parentIds
        .map(id => ({ id, title: parentTitle(id) }))
        .sort((a, b) => a.title.localeCompare(b.title));
    $('sel-parent').innerHTML = `<option value="">All</option><option value="0">Top level only</option>` +
        opts.map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('');
    if (![...$('sel-parent').options].some(o => o.value === state.parentFilter)) state.parentFilter = '';
    $('sel-parent').value = state.parentFilter;
}

function setLoading() {
    $tbody.innerHTML = Array.from({ length: 10 }, (_, i) => `<tr class="skel-row">
        <td><span class="skel" style="width:14px"></span></td><td><span class="skel" style="width:48px"></span></td>
        <td><span class="skel" style="width:${55 + (i * 17) % 35}%"></span></td><td><span class="skel" style="width:${40 + (i * 13) % 40}%"></span></td>
        <td class="hide-mob"><span class="skel" style="width:120px"></span></td><td></td></tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   Filtering, sorting, rendering
   ═══════════════════════════════════════════════════════════ */
function canReorder() {
    return state.sort === 'order' && !state.terms.length && state.view === 'all';
}

function visibleItems() {
    const ties = tieCounts();
    let list = state.items.filter(it => {
        if (state.parentFilter !== '' && it.parent !== Number(state.parentFilter)) return false;
        if (state.view === 'ties' && !(ties.get(cur(it, 'menu_order')) > 1)) return false;
        if (state.view === 'changed' && !state.edits.has(it.id) && !state.errors.has(it.id)) return false;
        if (state.terms.length) {
            const hay = `${cur(it, 'title')} ${cur(it, 'slug')} #${it.id} ${it.id}`.toLowerCase();
            if (!state.terms.every(t => hay.includes(t))) return false;
        }
        return true;
    });
    const byTitle = (a, b) => String(cur(a, 'title')).localeCompare(String(cur(b, 'title')), undefined, { sensitivity: 'base' });
    switch (state.sort) {
        // Same as WordPress: menu_order, then title.
        case 'order': list.sort((a, b) => (Number(cur(a, 'menu_order')) - Number(cur(b, 'menu_order'))) || byTitle(a, b)); break;
        case 'title': list.sort(byTitle); break;
        case 'date': list.sort((a, b) => String(cur(b, 'date')).localeCompare(String(cur(a, 'date'))) || b.id - a.id); break;
        default: list.sort((a, b) => b.id - a.id);
    }
    return list;
}

function render() {
    // Keep focus on the same field across a re-render (e.g. after re-sorting).
    const active = document.activeElement;
    const focusKey = active?.dataset?.f && active.closest('tr')?.dataset.id
        ? [active.closest('tr').dataset.id, active.dataset.f, active.selectionStart] : null;

    const list = visibleItems();
    state.visible = list.map(it => it.id);
    const ties = tieCounts();
    const reorder = canReorder();

    if (!list.length) {
        const filtered = state.terms.length || state.view !== 'all' || state.parentFilter !== '';
        $tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
            <p>${filtered ? 'Nothing matches the current filters' : `No published ${esc(noun(2))}`}</p>
            ${filtered ? `<button class="btn btn-ghost btn-sm" data-act="reset">Reset filters</button>` : ''}</div></td></tr>`;
    } else {
        $tbody.innerHTML = list.map((it, i) => rowHtml(it, i, list.length, ties, reorder)).join('');
    }

    if (focusKey) {
        const el = $tbody.querySelector(`tr[data-id="${focusKey[0]}"] [data-f="${focusKey[1]}"]`);
        if (el) {
            el.focus({ preventScroll: true });
            try { if (focusKey[2] != null) el.setSelectionRange(focusKey[2], focusKey[2]); } catch { /* number/date inputs */ }
        }
    }
    updateSummary(ties, list.length);
}

function rowHtml(it, i, n, ties, reorder) {
    const e = state.edits.get(it.id) || {};
    const err = state.errors.get(it.id);
    const ord = cur(it, 'menu_order');
    const tie = ties.get(ord) || 0;
    const cls = f => `cell-input${f in e ? ' changed' : ''}${fieldInvalid(it, f) ? ' invalid' : ''}`;
    const slug = String(cur(it, 'slug'));
    const path = pathFor(it);
    const isPage = state.type === 'page';
    const viewUrl = state.siteUrl ? `${state.siteUrl}/?p=${it.id}` : '';
    const editUrl = state.siteUrl ? `${state.siteUrl}/wp-admin/post.php?post=${it.id}&action=edit` : '';

    const urlPreview = isPage && state.siteUrl
        ? `<a class="url-preview" href="${escAttr(viewUrl)}" target="_blank" rel="noopener" title="${escAttr(state.siteUrl + '/' + path.join('/') + '/')}">/${path.slice(0, -1).map(p => esc(p) + '/').join('')}<span class="slug-part">${esc(path[path.length - 1])}</span>/</a>`
        : `<span class="url-preview">${esc(typeLabel(state.type))} · /${esc(sanitizeSlug(slug))}/</span>`;
    const slugNote = 'slug' in e ? `<span class="slug-warn" title="Old links to this ${escAttr(noun(1))} will break unless a redirect exists">URL changes</span>` : '';

    return `<tr class="row${state.edits.has(it.id) ? ' is-dirty' : ''}${err ? ' has-error' : ''}" data-id="${it.id}">
      <td><button class="handle${reorder ? '' : ' is-off'}" data-drag tabindex="-1"
          title="${reorder ? 'Drag to reorder' : 'Sort by Menu order (with no search or filter) to drag'}" aria-label="Drag to reorder">${ICON.grip}</button></td>
      <td><div class="order-cell">
          <div><input class="${cls('menu_order')} in-order" data-f="menu_order" type="number" step="1" value="${escAttr(ord)}" aria-label="Menu order">${tie > 1
            ? `<span class="tie" title="${tie} ${escAttr(noun(tie))} share order ${escAttr(ord)} — WordPress orders them by title">×${tie}</span>` : ''}</div>
          ${'menu_order' in e ? `<span class="was" title="Saved value">${esc(it.menu_order)}</span>` : ''}
      </div></td>
      <td>
        <input class="${cls('title')} in-title" data-f="title" type="text" value="${escAttr(cur(it, 'title'))}" aria-label="Title" spellcheck="true">
        <div class="sub-line"><span class="id">#${it.id}</span>${it.parent ? `<span>· in ${esc(parentTitle(it.parent))}</span>` : ''}</div>
        ${err ? `<div class="row-error">${esc(err)}</div>` : ''}
      </td>
      <td>
        <input class="${cls('slug')} in-slug" data-f="slug" type="text" value="${escAttr(slug)}" aria-label="Slug" spellcheck="false" autocomplete="off">
        <div class="sub-line">${urlPreview}${slugNote}</div>
      </td>
      <td class="hide-mob"><input class="${cls('date')} in-date" data-f="date" type="datetime-local" step="1" value="${escAttr(toInputDate(cur(it, 'date')))}" aria-label="Publish date"></td>
      <td><div class="actions">
        <span class="move-btns">
          <button class="icon-btn" data-act="up" ${!reorder || i === 0 ? 'disabled' : ''} title="Move up (Alt+↑)" aria-label="Move up">${ICON.up}</button>
          <button class="icon-btn" data-act="down" ${!reorder || i === n - 1 ? 'disabled' : ''} title="Move down (Alt+↓)" aria-label="Move down">${ICON.down}</button>
        </span>
        ${viewUrl ? `<a class="icon-btn" href="${escAttr(viewUrl)}" target="_blank" rel="noopener" title="View on the site">${ICON.view}</a>` : ''}
        ${editUrl ? `<a class="icon-btn" href="${escAttr(editUrl)}" target="_blank" rel="noopener" title="Open in WordPress">${ICON.wp}</a>` : ''}
        <button class="icon-btn revert" data-act="revert" ${state.edits.has(it.id) ? '' : 'hidden'} title="Undo changes to this row">${ICON.revert}</button>
      </div></td>
    </tr>`;
}

/* Counters, hint line, save bar. */
function updateSummary(ties = tieCounts(), shown = state.visible.length) {
    const total = state.items.length;
    let tied = 0;
    for (const it of state.items) if (ties.get(cur(it, 'menu_order')) > 1) tied++;
    const changed = state.edits.size;

    $('cnt-all').textContent = fmt(total);
    $('cnt-ties').textContent = fmt(tied);
    $('cnt-ties').classList.toggle('zero', !tied);
    $('cnt-changed').textContent = fmt(changed);
    $('cnt-changed').classList.toggle('zero', !changed);

    $('footer-info').innerHTML = `<strong>${fmt(shown)}</strong> of <strong>${fmt(total)}</strong> ${esc(noun(total))} shown`
        + (tied ? ` · <strong>${fmt(tied)}</strong> share an order number` : '');

    const hint = $('hintbar');
    if (canReorder()) {
        hint.innerHTML = `<span class="hint-icon">⋮⋮</span> Drag rows or use the ↑↓ buttons to reorder. Only rows that need a new number are changed.`;
    } else if (state.sort !== 'order') {
        hint.innerHTML = `To reorder, sort by menu order. <button class="link-btn" data-act="sort-order">Sort by menu order</button>`;
    } else {
        hint.innerHTML = `Reordering is off while a search or filter is active. <button class="link-btn" data-act="reset">Clear filters</button>`;
    }

    document.body.classList.toggle('has-changes', changed > 0);
    $('save-count').textContent = fmt(changed);
    $('save-label').textContent = changed === 1 ? `${noun(1)} changed` : `${noun(2)} changed`;
    document.title = changed ? `● Menu Order (${changed})` : 'Menu Order';
}

/* Cheap refresh of a single row after typing — keeps the caret in place. */
function refreshRowState(id) {
    const tr = $tbody.querySelector(`tr[data-id="${id}"]`);
    const it = item(id);
    if (!tr || !it) return;
    const e = state.edits.get(it.id) || {};
    tr.classList.toggle('is-dirty', state.edits.has(it.id));
    tr.classList.remove('has-error');
    tr.querySelector('.row-error')?.remove();
    tr.querySelectorAll('[data-f]').forEach(inp => {
        inp.classList.toggle('changed', inp.dataset.f in e);
        inp.classList.toggle('invalid', fieldInvalid(it, inp.dataset.f));
    });
    tr.querySelector('[data-act="revert"]').hidden = !state.edits.has(it.id);
    updateSummary();
}

/* ═══════════════════════════════════════════════════════════
   Reordering
   ═══════════════════════════════════════════════════════════ */

const titleCmp = (a, b) => String(cur(item(a), 'title')).localeCompare(String(cur(item(b), 'title')), undefined, { sensitivity: 'base' });

/* `ids` is the visible list in its new order with `movedId` in place.
   WordPress sorts by (menu_order, title), so a position is valid when that
   key puts the moved row between its neighbours — ties included. Two plans
   are tried: give the moved row a fitting number and nudge the rows AFTER
   it if needed, or nudge the rows BEFORE it. The plan touching fewer rows
   wins, so dropping into a block of equal numbers doesn't rewrite the
   whole block. */
function placeAt(ids, movedId) {
    const i = ids.indexOf(movedId);
    const last = ids.length - 1;

    const plan = dir => {
        const o = new Map(ids.map(id => [id, order(id)]));
        const before = (a, b) => (o.get(a) - o.get(b) || titleCmp(a, b)) < 0;
        const fits = () => (i === 0 || before(ids[i - 1], movedId)) && (i === last || before(movedId, ids[i + 1]));

        if (!fits()) {
            const prev = i > 0 ? o.get(ids[i - 1]) : null;
            const next = i < last ? o.get(ids[i + 1]) : null;
            const mid = prev !== null && next !== null ? Math.floor((prev + next) / 2) : null;
            const candidates = dir > 0
                ? [prev, mid, prev !== null ? prev + 1 : null, next, next !== null ? next - 1 : null, 0]
                : [next, mid, next !== null ? next - 1 : null, prev, prev !== null ? prev + 1 : null, 0];
            let ok = false;
            for (const c of candidates) {
                if (c === null || c < 0) continue;
                o.set(movedId, c);
                if (fits()) { ok = true; break; }
            }
            if (!ok) o.set(movedId, dir > 0 ? (prev !== null ? prev + 1 : 0) : Math.max(0, (next ?? 1) - 1));
        }

        if (dir > 0) {
            for (let j = i + 1; j <= last && !before(ids[j - 1], ids[j]); j++) {
                const p = o.get(ids[j - 1]);
                o.set(ids[j], titleCmp(ids[j], ids[j - 1]) > 0 ? p : p + 1);
            }
        } else {
            for (let j = i - 1; j >= 0 && !before(ids[j], ids[j + 1]); j--) {
                const n = o.get(ids[j + 1]);
                const v = titleCmp(ids[j], ids[j + 1]) < 0 ? n : n - 1;
                if (v < 0) return null;   // would need negative orders
                o.set(ids[j], v);
            }
        }

        // The list must now sort exactly as shown.
        for (let k = 0; k < last; k++) {
            const strict = ids[k] === movedId || ids[k + 1] === movedId;
            const c = o.get(ids[k]) - o.get(ids[k + 1]) || titleCmp(ids[k], ids[k + 1]);
            if (strict ? c >= 0 : c > 0) return null;
        }
        return { o, changes: ids.filter(id => o.get(id) !== order(id)) };
    };

    const best = [plan(1), plan(-1)].filter(Boolean).sort((a, b) => a.changes.length - b.changes.length)[0];
    if (!best) { showToast('Could not place the row there. Try Renumber instead.', 'error'); return; }
    for (const id of best.changes) setField(id, 'menu_order', best.o.get(id));
}

function moveBy(id, delta) {
    if (!canReorder()) return;
    const ids = [...state.visible];
    const i = ids.indexOf(Number(id));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, Number(id));
    placeAt(ids, Number(id));
    render();
    const btn = $tbody.querySelector(`tr[data-id="${id}"] [data-act="${delta < 0 ? 'up' : 'down'}"]`);
    const tr = $tbody.querySelector(`tr[data-id="${id}"]`);
    tr?.scrollIntoView({ block: 'nearest' });
    if (btn && !btn.disabled) btn.focus();
}

/* Pointer-based drag (works for mouse, pen and touch). The row is moved in
   the DOM live; on drop the new order is turned into menu_order values. */
let drag = null;

function startDrag(e, handle) {
    if (!canReorder()) {
        showToast(state.sort !== 'order' ? 'Sort by "Menu order" to drag rows' : 'Clear the search and filters to drag rows', 'info', 2600);
        return;
    }
    const row = handle.closest('tr');
    e.preventDefault();
    drag = { row, id: Number(row.dataset.id), start: [...$tbody.children].indexOf(row), y: e.clientY };
    row.classList.add('dragging');
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    drag.timer = setInterval(autoScroll, 16);
}

function onDragMove(e) {
    if (!drag) return;
    drag.y = e.clientY;
    const rows = [...$tbody.children].filter(r => r !== drag.row);
    const before = rows.find(r => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
    });
    if (before) { if (before !== drag.row.nextElementSibling) $tbody.insertBefore(drag.row, before); }
    else if ($tbody.lastElementChild !== drag.row) $tbody.appendChild(drag.row);
}

function autoScroll() {
    if (!drag) return;
    const box = $wrap.getBoundingClientRect();
    const edge = 48;
    if (drag.y < box.top + edge + 38) $wrap.scrollTop -= Math.ceil((box.top + edge + 38 - drag.y) / 4);
    else if (drag.y > box.bottom - edge) $wrap.scrollTop += Math.ceil((drag.y - box.bottom + edge) / 4);
}

function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    document.body.classList.remove('is-dragging');
    const { row, id, start } = drag;
    drag = null;
    row.classList.remove('dragging');
    const ids = [...$tbody.querySelectorAll('tr.row')].map(r => Number(r.dataset.id));
    if (ids.indexOf(id) !== start) placeAt(ids, id);
    render();
}

/* ── Renumber dialog ───────────────────────────────────────── */
function openRenumber() {
    if (!state.visible.length) { showToast('Nothing to renumber in this view', 'info'); return; }
    const n = state.visible.length;
    const sortName = $('sel-sort').selectedOptions[0].textContent.toLowerCase();
    $('renumber-text').innerHTML = `Gives the <strong>${fmt(n)}</strong> ${esc(noun(n))} in view new order numbers, top to bottom, in the order shown (<strong>${esc(sortName)}</strong>).`
        + (n < state.items.length ? ` ${esc(noun(2))} not in view are left as they are.` : '');
    updateRenumberPreview();
    openModal('renumber-modal');
    $('rn-start').select();
}

function renumberValues() {
    const start = parseInt($('rn-start').value, 10);
    const step = Math.max(1, parseInt($('rn-step').value, 10) || 1);
    const n = state.visible.length;
    if (Number.isNaN(start)) return null;
    const vals = Array.from({ length: n }, (_, i) => start + i * step);
    return $('rn-reverse').checked ? vals.reverse() : vals;
}

function updateRenumberPreview() {
    const vals = renumberValues();
    if (!vals) { $('rn-preview').textContent = 'Enter a start number.'; $('btn-rn-apply').disabled = true; return; }
    $('btn-rn-apply').disabled = false;
    const changes = state.visible.filter((id, i) => order(id) !== vals[i]).length;
    const shown = vals.length > 4 ? `${vals.slice(0, 3).join(', ')}, … ${vals[vals.length - 1]}` : vals.join(', ');
    $('rn-preview').innerHTML = `New orders: <strong>${esc(shown)}</strong><br>${plural(changes, 'row')} will change.`;
}

function applyRenumber() {
    const vals = renumberValues();
    if (!vals) return;
    let changed = 0;
    state.visible.forEach((id, i) => { if (order(id) !== vals[i]) { setField(id, 'menu_order', vals[i]); changed++; } });
    closeModals();
    render();
    showToast(changed ? `Renumbered ${plural(changed, 'row')}. Review and save when ready.` : 'Already numbered like that, nothing changed', changed ? 'success' : 'info');
}

/* ═══════════════════════════════════════════════════════════
   Review & save
   ═══════════════════════════════════════════════════════════ */
function openReview() {
    if (!state.edits.size) { showToast('No unsaved changes', 'info'); return; }

    const invalid = [...state.edits.keys()].map(item).filter(it => FIELDS.some(f => fieldInvalid(it, f)));
    if (invalid.length) {
        showToast(`Fix the ${plural(invalid.length, 'highlighted row')} first (empty title or slug, or a non-whole number)`, 'error');
        state.view = 'changed';
        syncViewTabs();
        render();
        $tbody.querySelector('.invalid')?.focus();
        return;
    }

    const ids = [...state.edits.keys()].sort((a, b) => order(a) - order(b));
    const slugChanges = ids.filter(id => 'slug' in state.edits.get(id)).length;
    $('review-sub').textContent = `${plural(ids.length, noun(1), noun(2))}`;
    $('review-warn').hidden = !slugChanges;
    $('review-warn').textContent = slugChanges
        ? `${plural(slugChanges, 'slug')} will change, so those URLs change too. Existing links and search results will 404 unless a redirect is set up.` : '';
    $('review-list').innerHTML = ids.map(id => {
        const it = item(id), e = state.edits.get(id);
        const fields = FIELDS.filter(f => f in e).map(f => `<div class="rv-field">
            <span class="rv-label">${FIELD_LABEL[f]}</span>
            <span class="rv-vals"><span class="rv-old">${esc(it[f])}</span><span class="rv-arrow">→</span><span class="rv-new">${esc(f === 'slug' ? sanitizeSlug(e[f]) : e[f])}</span></span>
        </div>`).join('');
        return `<div class="rv-item"><div class="rv-head"><span class="id">#${id}</span><span>${esc(cur(it, 'title'))}</span></div>${fields}</div>`;
    }).join('');
    $('review-db').textContent = `Writes to ${state.dbLabel || 'the database'}`;
    $('btn-save').textContent = `Save ${plural(ids.length, noun(1), noun(2))}`;
    openModal('review-modal');
    $('btn-save').focus();
}

async function save() {
    if (state.saving) return;
    state.saving = true;
    const btn = $('btn-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const changes = [...state.edits.entries()].map(([id, e]) => {
        const c = { id, modified: item(id).modified };
        for (const f of FIELDS) if (f in e) c[f] = f === 'slug' ? sanitizeSlug(e[f]) : e[f];
        return c;
    });

    try {
        const data = await api('save', { body: { post_type: state.type, changes } });
        if (data.status === 'success') {
            const map = { post_title: 'title', post_name: 'slug', post_date: 'date', menu_order: 'menu_order' };
            const saved = [];
            for (const row of data.items) {
                const it = item(row.id);
                for (const [col, f] of Object.entries(map)) if (col in row) it[f] = col === 'menu_order' ? Number(row[col]) : row[col];
                it.modified = data.modified;
                state.edits.delete(row.id);
                saved.push(row.id);
            }
            state.errors.clear();
            closeModals();
            if (state.view === 'changed') { state.view = 'all'; syncViewTabs(); }
            render();
            saved.forEach(id => $tbody.querySelector(`tr[data-id="${id}"]`)?.classList.add('flash'));
            showToast(`Saved ${plural(data.updated, noun(1), noun(2))}`, 'success');
        } else if (data.status === 'invalid') {
            state.errors = new Map(data.errors.map(er => [er.id, er.message]));
            closeModals();
            state.view = 'changed';
            syncViewTabs();
            render();
            showToast(data.message, 'error');
        } else {
            showToast(data.message || 'Save failed', 'error');
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
    } finally {
        state.saving = false;
        btn.disabled = false;
    }
}

/* Discard needs a second click within 3s. That's lighter than a dialog and
   still hard to hit by accident. */
let discardArmed = null;
function discardAll() {
    const btn = $('btn-discard');
    if (!discardArmed) {
        btn.textContent = 'Click again to discard';
        discardArmed = setTimeout(() => { discardArmed = null; btn.textContent = 'Discard all'; }, 3000);
        return;
    }
    clearTimeout(discardArmed);
    discardArmed = null;
    btn.textContent = 'Discard all';
    state.edits.clear();
    state.errors.clear();
    render();
    showToast('All changes discarded', 'info', 2400);
}

/* ═══════════════════════════════════════════════════════════
   Modals, theme, filters
   ═══════════════════════════════════════════════════════════ */
function openModal(id) { $(id).classList.add('open'); }
function closeModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }
const anyModalOpen = () => !!document.querySelector('.modal-overlay.open');

function effectiveTheme() {
    return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function updateThemeButton() {
    const dark = effectiveTheme() === 'dark';
    $('btn-theme').innerHTML = dark ? ICON.sun : ICON.moon;
    $('btn-theme').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}

function syncViewTabs() {
    document.querySelectorAll('#view-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
}

function resetFilters() {
    state.search = '';
    state.terms = [];
    $('inp-search').value = '';
    $('searchbox').classList.remove('has-value');
    state.view = 'all';
    state.parentFilter = '';
    if (!$('parent-wrap').hidden) $('sel-parent').value = '';
    syncViewTabs();
    render();
}

function setSort(s) {
    state.sort = s;
    $('sel-sort').value = s;
    lsSet(LS.sort, s);
    render();
}

/* Switching type or site would throw edits away, so block it instead. */
function guardUnsaved(revert) {
    if (!state.edits.size) return true;
    showToast(`Save or discard your ${plural(state.edits.size, 'unsaved change')} first`, 'error');
    revert();
    return false;
}

/* ═══════════════════════════════════════════════════════════
   Events
   ═══════════════════════════════════════════════════════════ */
function bindEvents() {
    $('btn-theme').addEventListener('click', () => {
        const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        lsSet(LS.theme, next);
        updateThemeButton();
    });
    $('btn-help').addEventListener('click', () => openModal('help-modal'));

    $('site-select').addEventListener('change', e => {
        const prev = [...e.target.options].find(o => o.defaultSelected)?.value;
        if (!guardUnsaved(() => { e.target.value = prev; })) return;
        document.cookie = `mo_db=${encodeURIComponent(e.target.value)}; path=${location.pathname.replace(/[^/]*$/, '')}; max-age=${60 * 60 * 24 * 365}`;
        location.reload();
    });

    $('sel-type').addEventListener('change', e => {
        if (!guardUnsaved(() => { e.target.value = state.type; })) return;
        state.type = e.target.value;
        lsSet(LS.type, state.type);
        state.parentFilter = '';
        loadItems();
    });
    $('sel-parent').addEventListener('change', e => { state.parentFilter = e.target.value; render(); });
    $('sel-sort').addEventListener('change', e => setSort(e.target.value));

    let t = null;
    $('inp-search').addEventListener('input', e => {
        $('searchbox').classList.toggle('has-value', !!e.target.value);
        clearTimeout(t);
        t = setTimeout(() => {
            state.search = e.target.value;
            state.terms = e.target.value.toLowerCase().split(/\s+/).filter(Boolean);
            render();
        }, 120);
    });
    $('btn-search-clear').addEventListener('click', () => {
        $('inp-search').value = '';
        $('searchbox').classList.remove('has-value');
        state.search = '';
        state.terms = [];
        render();
        $('inp-search').focus();
    });

    $('view-tabs').addEventListener('click', e => {
        const b = e.target.closest('.seg-btn');
        if (!b) return;
        state.view = b.dataset.view;
        syncViewTabs();
        render();
    });

    $('btn-renumber').addEventListener('click', openRenumber);
    ['rn-start', 'rn-step', 'rn-reverse'].forEach(id => $(id).addEventListener('input', updateRenumberPreview));
    $('btn-rn-apply').addEventListener('click', applyRenumber);
    $('renumber-modal').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('btn-rn-apply').disabled) applyRenumber(); });

    $('btn-review').addEventListener('click', openReview);
    $('btn-discard').addEventListener('click', discardAll);
    $('btn-save').addEventListener('click', save);

    document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => {
        if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('open');
    }));

    /* Inline edits */
    $tbody.addEventListener('input', e => {
        const f = e.target.dataset.f;
        if (!f) return;
        const id = e.target.closest('tr').dataset.id;
        setField(id, f, e.target.value);
        refreshRowState(id);
    });
    // On commit (blur / Enter): tidy slugs and re-render so sorting, ties and
    // the URL preview catch up.
    $tbody.addEventListener('change', e => {
        const f = e.target.dataset.f;
        if (!f) return;
        const id = e.target.closest('tr').dataset.id;
        if (f === 'slug') {
            const clean = sanitizeSlug(e.target.value);
            if (clean && clean !== e.target.value) e.target.value = clean;
            setField(id, f, clean || e.target.value);
        }
        // Deferred: "change" fires on blur, before focus lands on whatever
        // was clicked next — rendering now would rebuild that element away.
        setTimeout(render, 0);
    });
    $tbody.addEventListener('keydown', e => {
        const tr = e.target.closest('tr.row');
        if (!tr) return;
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            moveBy(tr.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
        } else if (e.key === 'Enter' && e.target.dataset.f) {
            e.target.blur();
        } else if (e.key === 'Escape' && e.target.dataset.f) {
            // Esc inside a field puts that one field back.
            e.stopPropagation();
            setField(tr.dataset.id, e.target.dataset.f, item(tr.dataset.id)[e.target.dataset.f]);
            render();
        }
    });

    $tbody.addEventListener('pointerdown', e => {
        const h = e.target.closest('[data-drag]');
        if (h && e.button === 0) startDrag(e, h);
    });

    document.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const id = el.closest('tr')?.dataset.id;
        switch (el.dataset.act) {
            case 'up': moveBy(id, -1); break;
            case 'down': moveBy(id, 1); break;
            case 'revert': revertRow(id); break;
            case 'reset': resetFilters(); break;
            case 'sort-order': setSort('order'); break;
            case 'reload': loadItems(); break;
        }
    });

    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if ($('review-modal').classList.contains('open')) save();
            else openReview();
            return;
        }
        if (e.key === 'Escape') {
            if (anyModalOpen()) { closeModals(); return; }
            if (state.search) { $('btn-search-clear').click(); $('inp-search').blur(); }
            return;
        }
        if (anyModalOpen()) return;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
        if (!typing && e.key === '/') { e.preventDefault(); $('inp-search').focus(); }
        if (!typing && e.key === '?') { e.preventDefault(); openModal('help-modal'); }
    });

    window.addEventListener('beforeunload', e => {
        if (state.edits.size) { e.preventDefault(); e.returnValue = ''; }
    });
}

/* ── Init ──────────────────────────────────────────────────── */
(async function init() {
    state.type = lsGet(LS.type, 'page');
    const sort = lsGet(LS.sort, 'newest');
    if ([...$('sel-sort').options].some(o => o.value === sort)) state.sort = sort;
    $('sel-sort').value = state.sort;
    updateThemeButton();
    setLoading();
    bindEvents();
    await Promise.all([loadDatabases(), loadTypes()]);
    await loadItems();
})();
