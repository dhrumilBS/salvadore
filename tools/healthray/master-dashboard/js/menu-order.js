/* ══════════════════════════ Menu Order tab ══════════════════════════
 * Port of the former ../menu-order/ tool. Page order, titles, slugs and
 * publish dates of one post type, edited inline.
 *
 * · Every edit stays client-side (state.edits) until "Review & save", which
 *   previews every old -> new value in confirmDialog() and then sends one
 *   atomic batch to api/menu_save.php. Nothing auto-saves.
 * · Reordering (drag handle, ↑/↓ buttons, Alt+↑/↓) only renumbers the rows
 *   that actually need a new number, so a single move doesn't rewrite the
 *   whole table.
 * · The server refuses the whole save if any post was modified after it was
 *   loaded (optimistic lock on post_modified).
 *
 * Everything lives in this IIFE; the only globals are the four functions
 * app.js calls: bindMenuTab(), loadMenu(), moHandleKey(e), moHasUnsaved().
 * Element ids are mo- prefixed; all listeners are scoped to #menuView or to
 * this tab's own modal (#mo-renumber-modal).
 * ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const FIELDS = ['menu_order', 'title', 'slug', 'date'];
    const FIELD_LABEL = { menu_order: 'Order', title: 'Title', slug: 'Slug', date: 'Published' };

    const POST_TYPE_LABELS = {
        post: 'Blog Posts', page: 'Pages', whitepaper: 'Whitepapers', 'case-studies': 'Case Studies',
        jobs: 'Jobs', job: 'Jobs (draft)', events: 'Events', event: 'Events (draft)', faq: 'FAQ Entries',
        alternatives: 'Alternatives',
    };

    const LS_SORT = 'mo.sort';
    const lsTypeKey = () => `mo.${SITE || 'default'}.type`;

    const state = {
        type: 'page',
        items: [],
        byId: new Map(),
        parents: new Map(),   // id -> { title, slug, parent } for parents outside the list
        edits: new Map(),     // id -> { field: value } - only fields that differ from the DB
        errors: new Map(),    // id -> message from the last save attempt
        sort: 'newest',
        view: 'all',          // all | ties | changed
        parentFilter: '',
        terms: [],
        visible: [],          // ids currently rendered, in display order
        siteUrl: '',
        loaded: false,        // a list has been loaded at least once
        loading: false,
        saving: false,
        staleWhileDirty: false, // a reload was asked for while there were unsaved edits
    };

    let root = null, tbody = null, wrap = null;
    let bound = false;
    let confirming = false;       // our confirmDialog() is the one on screen
    let discardArmed = null;
    let drag = null;
    const handledKeys = new WeakSet(); // keydowns already handled by the tab's own listeners
    const nextListSignal = latestOnly();
    const nextTypesSignal = latestOnly();

    /* ── Helpers ───────────────────────────────────────────────── */
    const el = id => document.getElementById(id);
    const esc = escapeHtml; // escapes quotes too, so it's safe in attributes
    function plural(n, word, many = word + 's') { return `${fmtNum(n)} ${n === 1 ? word : many}`; }
    // md.<k> via mdStore (same physical keys as before); strings in, strings out.
    function lsGet(k, d) { const v = mdStore.get(k, null); return v === null ? d : String(v); }
    function lsSet(k, v) { mdStore.set(k, String(v)); }
    function typeLabel(t) { return POST_TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : ''); }
    function noun(n) {
        const label = typeLabel(state.type).toLowerCase();
        return n === 1 ? label.replace(/ies$/, 'y').replace(/s$/, '') : label;
    }

    /* Same rules as mo_sanitize_slug() (api/lib/menu_order.php) / WordPress for ASCII slugs. */
    function sanitizeSlug(s) {
        return String(s || '').trim().toLowerCase()
            .replace(/[\s_./]+/g, '-').replace(/[^a-z0-9%-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    /* DB "YYYY-MM-DD HH:MM:SS" <-> <input type=datetime-local step=1> value */
    const toInputDate = d => String(d || '').replace(' ', 'T');
    function fromInputDate(v) {
        let s = String(v || '').replace('T', ' ');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
        return s;
    }

    const ICON = {
        grip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
        up: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>`,
        down: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`,
        view: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
        wp: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
        revert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>`,
    };

    /* ═══════════════════════ Values & edits ═══════════════════════ */
    function item(id) { return state.byId.get(Number(id)); }

    /* Current value of a field - the pending edit if there is one. */
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
        afterEditsCleared();
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

    /* ═══════════════════════ Loading ═══════════════════════ */
    async function loadTypes() {
        try {
            const data = await api('menu_types.php', { signal: nextTypesSignal() });
            if (!data.success) throw new Error(data.msg || 'Unknown error');
            const types = data.post_types || [];
            if (!types.some(t => t.post_type === state.type)) {
                state.type = types.some(t => t.post_type === 'page') ? 'page' : (types[0]?.post_type || 'page');
            }
            el('mo-type').innerHTML = types.map(t =>
                `<option value="${esc(t.post_type)}"${t.post_type === state.type ? ' selected' : ''}>${esc(typeLabel(t.post_type))} (${fmtNum(t.count)})</option>`).join('');
        } catch (e) {
            if (isAbort(e)) throw e;
            toast('Could not load content types: ' + e.message, 'err');
        }
    }

    async function loadItems() {
        state.loading = true;
        setLoading();
        try {
            const data = await api('menu_list.php', { params: { type: state.type }, signal: nextListSignal() });
            if (!data.success) throw new Error(data.msg || 'Unknown error');
            // The server falls back to "page" for a type it doesn't offer.
            if (data.post_type && data.post_type !== state.type) {
                state.type = data.post_type;
                el('mo-type').value = state.type;
            }
            state.items = data.items || [];
            state.byId = new Map(state.items.map(it => [it.id, it]));
            state.parents = new Map((data.parents || []).map(p => [p.id, p]));
            state.edits.clear();
            state.errors.clear();
            state.staleWhileDirty = false;
            state.loaded = true;
            state.siteUrl = data.site_url || '';
            const link = el('mo-site-url');
            link.textContent = state.siteUrl.replace(/^https?:\/\//, '');
            link.href = state.siteUrl || '#';
            link.hidden = !state.siteUrl;
            buildParentFilter();
            render();
        } catch (e) {
            if (isAbort(e)) return;
            tbody.innerHTML = `<tr><td colspan="6"><div class="mo-empty"><p>Could not load ${esc(noun(2))}</p>
                <div class="mo-empty-sub">${esc(e.message)}</div><button type="button" class="btn small" data-act="reload">Try again</button></div></td></tr>`;
        } finally {
            state.loading = false;
        }
    }

    function buildParentFilter() {
        const parentIds = [...new Set(state.items.map(it => it.parent).filter(Boolean))];
        const sel = el('mo-parent');
        el('mo-parent-wrap').hidden = !parentIds.length;
        if (!parentIds.length) { state.parentFilter = ''; return; }
        const opts = parentIds
            .map(id => ({ id, title: parentTitle(id) }))
            .sort((a, b) => String(a.title).localeCompare(String(b.title)));
        sel.innerHTML = `<option value="">All</option><option value="0">Top level only</option>` +
            opts.map(o => `<option value="${o.id}">${esc(decodeEntities(o.title))}</option>`).join('');
        if (![...sel.options].some(o => o.value === state.parentFilter)) state.parentFilter = '';
        sel.value = state.parentFilter;
    }

    function setLoading() {
        tbody.innerHTML = Array.from({ length: 10 }, (_, i) => `<tr class="mo-skel-row">
            <td><span class="mo-skel" style="width:14px"></span></td><td><span class="mo-skel" style="width:48px"></span></td>
            <td><span class="mo-skel" style="width:${55 + (i * 17) % 35}%"></span></td><td><span class="mo-skel" style="width:${40 + (i * 13) % 40}%"></span></td>
            <td class="mo-hide-mob"><span class="mo-skel" style="width:120px"></span></td><td></td></tr>`).join('');
    }

    /* ═══════════════════════ Filtering, sorting, rendering ═══════════════════════ */
    function canReorder() {
        return state.sort === 'order' && !state.terms.length && state.view === 'all';
    }

    function visibleItems() {
        const ties = tieCounts();
        const list = state.items.filter(it => {
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
        if (!tbody) return;
        // Keep focus on the same field across a re-render (e.g. after re-sorting).
        const active = document.activeElement;
        const focusKey = active && tbody.contains(active) && active.dataset?.f && active.closest('tr')?.dataset.id
            ? [active.closest('tr').dataset.id, active.dataset.f, active.selectionStart] : null;

        const list = visibleItems();
        state.visible = list.map(it => it.id);
        const ties = tieCounts();
        const reorder = canReorder();

        if (!list.length) {
            const filtered = state.terms.length || state.view !== 'all' || state.parentFilter !== '';
            tbody.innerHTML = `<tr><td colspan="6"><div class="mo-empty">
                <p>${filtered ? 'Nothing matches the current filters' : `No published ${esc(noun(2))}`}</p>
                ${filtered ? `<button type="button" class="btn small" data-act="reset">Reset filters</button>` : ''}</div></td></tr>`;
        } else {
            tbody.innerHTML = list.map((it, i) => rowHtml(it, i, list.length, ties, reorder)).join('');
        }

        if (focusKey) {
            const f = tbody.querySelector(`tr[data-id="${focusKey[0]}"] [data-f="${focusKey[1]}"]`);
            if (f) {
                f.focus({ preventScroll: true });
                try { if (focusKey[2] != null) f.setSelectionRange(focusKey[2], focusKey[2]); } catch (e) { /* number/date inputs */ }
            }
        }
        updateSummary(ties, list.length);
    }

    function rowHtml(it, i, n, ties, reorder) {
        const e = state.edits.get(it.id) || {};
        const err = state.errors.get(it.id);
        const ord = cur(it, 'menu_order');
        const tie = ties.get(ord) || 0;
        const cls = f => `mo-cell-input${f in e ? ' mo-changed' : ''}${fieldInvalid(it, f) ? ' mo-invalid' : ''}`;
        const slug = String(cur(it, 'slug'));
        const path = pathFor(it);
        const isPage = state.type === 'page';
        const viewUrl = state.siteUrl ? `${state.siteUrl}/?p=${it.id}` : '';
        const editUrl = state.siteUrl ? `${state.siteUrl}/wp-admin/post.php?post=${it.id}&action=edit` : '';

        const urlPreview = isPage && state.siteUrl
            ? `<a class="mo-url-preview" href="${esc(viewUrl)}" target="_blank" rel="noopener" title="${esc(state.siteUrl + '/' + path.join('/') + '/')}">/${path.slice(0, -1).map(p => esc(p) + '/').join('')}<span class="mo-slug-part">${esc(path[path.length - 1])}</span>/</a>`
            : `<span class="mo-url-preview">${esc(typeLabel(state.type))} · /${esc(sanitizeSlug(slug))}/</span>`;
        const slugNote = 'slug' in e ? `<span class="mo-slug-warn" title="Old links to this ${esc(noun(1))} will break unless a redirect exists">URL changes</span>` : '';

        return `<tr class="mo-row${state.edits.has(it.id) ? ' mo-dirty' : ''}${err ? ' mo-has-error' : ''}" data-id="${it.id}">
          <td><button type="button" class="mo-handle${reorder ? '' : ' mo-off'}" data-drag tabindex="-1"
              title="${reorder ? 'Drag to reorder' : 'Sort by Menu order (with no search or filter) to drag'}" aria-label="Drag to reorder">${ICON.grip}</button></td>
          <td><div class="mo-order-cell">
              <div class="mo-order-line"><input class="${cls('menu_order')} mo-in-order" data-f="menu_order" type="number" step="1" value="${esc(ord)}" aria-label="Menu order">${tie > 1
                ? `<span class="mo-tie" title="${tie} ${esc(noun(tie))} share order ${esc(ord)} — WordPress orders them by title">×${tie}</span>` : ''}</div>
              ${'menu_order' in e ? `<span class="mo-was" title="Saved value">${esc(it.menu_order)}</span>` : ''}
          </div></td>
          <td>
            <input class="${cls('title')} mo-in-title" data-f="title" type="text" value="${esc(cur(it, 'title'))}" aria-label="Title" spellcheck="true">
            <div class="mo-sub-line"><span class="mo-id">#${it.id}</span>${it.parent ? `<span>· in ${esc(parentTitle(it.parent))}</span>` : ''}</div>
            ${err ? `<div class="mo-row-error">${esc(err)}</div>` : ''}
          </td>
          <td>
            <input class="${cls('slug')} mo-in-slug" data-f="slug" type="text" value="${esc(slug)}" aria-label="Slug" spellcheck="false" autocomplete="off">
            <div class="mo-sub-line">${urlPreview}${slugNote}</div>
          </td>
          <td class="mo-hide-mob"><input class="${cls('date')} mo-in-date" data-f="date" type="datetime-local" step="1" value="${esc(toInputDate(cur(it, 'date')))}" aria-label="Publish date"></td>
          <td><div class="mo-actions">
            <span class="mo-move-btns">
              <button type="button" class="mo-icon-btn" data-act="up" ${!reorder || i === 0 ? 'disabled' : ''} title="Move up (Alt+↑)" aria-label="Move up">${ICON.up}</button>
              <button type="button" class="mo-icon-btn" data-act="down" ${!reorder || i === n - 1 ? 'disabled' : ''} title="Move down (Alt+↓)" aria-label="Move down">${ICON.down}</button>
            </span>
            ${viewUrl ? `<a class="mo-icon-btn" href="${esc(viewUrl)}" target="_blank" rel="noopener" title="View on the site" aria-label="View on the site">${ICON.view}</a>` : ''}
            ${editUrl ? `<a class="mo-icon-btn" href="${esc(editUrl)}" target="_blank" rel="noopener" title="Open in WordPress" aria-label="Open in WordPress">${ICON.wp}</a>` : ''}
            <button type="button" class="mo-icon-btn mo-revert" data-act="revert" ${state.edits.has(it.id) ? '' : 'hidden'} title="Undo changes to this row" aria-label="Undo changes to this row">${ICON.revert}</button>
          </div></td>
        </tr>`;
    }

    /* Counters, hint line, save bar. */
    function updateSummary(ties = tieCounts(), shown = state.visible.length) {
        const total = state.items.length;
        let tied = 0;
        for (const it of state.items) if (ties.get(cur(it, 'menu_order')) > 1) tied++;
        const changed = state.edits.size;

        el('mo-cnt-all').textContent = fmtNum(total);
        el('mo-cnt-ties').textContent = fmtNum(tied);
        el('mo-cnt-ties').classList.toggle('mo-zero', !tied);
        el('mo-cnt-changed').textContent = fmtNum(changed);
        el('mo-cnt-changed').classList.toggle('mo-zero', !changed);

        el('mo-footer-info').innerHTML = `<b>${fmtNum(shown)}</b> of <b>${fmtNum(total)}</b> ${esc(noun(total))} shown`
            + (tied ? ` · <b>${fmtNum(tied)}</b> share an order number` : '');

        const hint = el('mo-hintbar');
        let html;
        if (canReorder()) {
            html = `<span class="mo-hint-icon">⋮⋮</span> Drag rows or use the ↑↓ buttons to reorder. Only rows that need a new number are changed.`;
        } else if (state.sort !== 'order') {
            html = `To reorder, sort by menu order. <button type="button" class="mo-link-btn" data-act="sort-order">Sort by menu order</button>`;
        } else {
            html = `Reordering is off while a search or filter is active. <button type="button" class="mo-link-btn" data-act="reset">Clear filters</button>`;
        }
        if (state.staleWhileDirty) {
            html += ` <span class="mo-stale">This list may be out of date - it reloads once your changes are saved or discarded.</span>`;
        }
        hint.innerHTML = html;

        root.classList.toggle('mo-has-changes', changed > 0);
        el('mo-save-count').textContent = fmtNum(changed);
        el('mo-save-label').textContent = changed === 1 ? `${noun(1)} changed` : `${noun(2)} changed`;
    }

    /* Cheap refresh of a single row after typing - keeps the caret in place. */
    function refreshRowState(id) {
        const tr = tbody.querySelector(`tr[data-id="${id}"]`);
        const it = item(id);
        if (!tr || !it) return;
        const e = state.edits.get(it.id) || {};
        tr.classList.toggle('mo-dirty', state.edits.has(it.id));
        tr.classList.remove('mo-has-error');
        tr.querySelector('.mo-row-error')?.remove();
        tr.querySelectorAll('[data-f]').forEach(inp => {
            inp.classList.toggle('mo-changed', inp.dataset.f in e);
            inp.classList.toggle('mo-invalid', fieldInvalid(it, inp.dataset.f));
        });
        tr.querySelector('[data-act="revert"]').hidden = !state.edits.has(it.id);
        updateSummary();
    }

    /* ═══════════════════════ Reordering ═══════════════════════ */
    const titleCmp = (a, b) => String(cur(item(a), 'title')).localeCompare(String(cur(item(b), 'title')), undefined, { sensitivity: 'base' });

    /* `ids` is the visible list in its new order with `movedId` in place.
       WordPress sorts by (menu_order, title), so a position is valid when that
       key puts the moved row between its neighbours - ties included. Two plans
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
                    const nx = o.get(ids[j + 1]);
                    const v = titleCmp(ids[j], ids[j + 1]) < 0 ? nx : nx - 1;
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
        if (!best) { toast('Could not place the row there. Try Renumber instead.', 'err'); return; }
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
        const btn = tbody.querySelector(`tr[data-id="${id}"] [data-act="${delta < 0 ? 'up' : 'down'}"]`);
        const tr = tbody.querySelector(`tr[data-id="${id}"]`);
        tr?.scrollIntoView({ block: 'nearest' });
        if (btn && !btn.disabled) btn.focus();
    }

    /* Pointer-based drag (mouse, pen and touch). The row is moved in the DOM
       live; on drop the new order is turned into menu_order values. */
    function startDrag(e, handle) {
        if (!canReorder()) {
            toast(state.sort !== 'order' ? 'Sort by "Menu order" to drag rows' : 'Clear the search and filters to drag rows', '', 2600);
            return;
        }
        const row = handle.closest('tr');
        e.preventDefault();
        drag = { row, id: Number(row.dataset.id), start: [...tbody.children].indexOf(row), y: e.clientY };
        row.classList.add('mo-dragging');
        root.classList.add('mo-is-dragging');
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        drag.timer = setInterval(autoScroll, 16);
    }

    function onDragMove(e) {
        if (!drag) return;
        drag.y = e.clientY;
        const rows = [...tbody.children].filter(r => r !== drag.row);
        const before = rows.find(r => {
            const b = r.getBoundingClientRect();
            return e.clientY < b.top + b.height / 2;
        });
        if (before) { if (before !== drag.row.nextElementSibling) tbody.insertBefore(drag.row, before); }
        else if (tbody.lastElementChild !== drag.row) tbody.appendChild(drag.row);
    }

    /* Scroll the table pane - or the page, when the pane's edge is off-screen. */
    function autoScroll() {
        if (!drag) return;
        const box = wrap.getBoundingClientRect();
        const edge = 48;
        const top = Math.max(box.top, 0) + edge + 38; // + sticky header
        const bottom = Math.min(box.bottom, window.innerHeight) - edge;
        let dy = 0;
        if (drag.y < top) dy = -Math.ceil((top - drag.y) / 4);
        else if (drag.y > bottom) dy = Math.ceil((drag.y - bottom) / 4);
        if (!dy) return;
        const before = wrap.scrollTop;
        wrap.scrollTop += dy;
        if (wrap.scrollTop === before) window.scrollBy(0, dy);
        onDragMove({ clientY: drag.y });
    }

    function endDrag() {
        if (!drag) return;
        clearInterval(drag.timer);
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        root.classList.remove('mo-is-dragging');
        const { row, id, start } = drag;
        drag = null;
        row.classList.remove('mo-dragging');
        const ids = [...tbody.querySelectorAll('tr.mo-row')].map(r => Number(r.dataset.id));
        if (ids.indexOf(id) !== start) placeAt(ids, id);
        render();
    }

    /* ═══════════════════════ Renumber dialog ═══════════════════════ */
    const renumberModal = () => el('mo-renumber-modal');
    const isRenumberOpen = () => !!renumberModal()?.classList.contains('open');

    function openRenumber() {
        if (!state.visible.length) { toast('Nothing to renumber in this view'); return; }
        const n = state.visible.length;
        const sortName = el('mo-sort').selectedOptions[0].textContent.toLowerCase();
        el('mo-renumber-title').textContent = `Renumber ${typeLabel(state.type).toLowerCase()}`;
        el('mo-renumber-text').innerHTML = `Gives the <strong>${fmtNum(n)}</strong> ${esc(noun(n))} in view new order numbers, top to bottom, in the order shown (<strong>${esc(sortName)}</strong>).`
            + (n < state.items.length ? ` ${esc(typeLabel(state.type))} not in view are left as they are.` : '');
        updateRenumberPreview();
        renumberModal().classList.add('open');
        el('mo-rn-start').focus();
        el('mo-rn-start').select();
    }

    function closeRenumber() {
        if (!isRenumberOpen()) return;
        renumberModal().classList.remove('open');
        el('mo-renumber')?.focus();
    }

    function renumberValues() {
        const start = parseInt(el('mo-rn-start').value, 10);
        const step = Math.max(1, parseInt(el('mo-rn-step').value, 10) || 1);
        const n = state.visible.length;
        if (Number.isNaN(start)) return null;
        const vals = Array.from({ length: n }, (_, i) => start + i * step);
        return el('mo-rn-reverse').checked ? vals.reverse() : vals;
    }

    function updateRenumberPreview() {
        const vals = renumberValues();
        const apply = el('mo-rn-apply');
        if (!vals) { el('mo-rn-preview').textContent = 'Enter a start number.'; apply.disabled = true; return; }
        apply.disabled = false;
        const changes = state.visible.filter((id, i) => order(id) !== vals[i]).length;
        const shown = vals.length > 4 ? `${vals.slice(0, 3).join(', ')}, … ${vals[vals.length - 1]}` : vals.join(', ');
        el('mo-rn-preview').innerHTML = `New orders: <strong>${esc(shown)}</strong><br>${plural(changes, 'row')} will change.`;
    }

    function applyRenumber() {
        const vals = renumberValues();
        if (!vals) return;
        let changed = 0;
        state.visible.forEach((id, i) => { if (order(id) !== vals[i]) { setField(id, 'menu_order', vals[i]); changed++; } });
        closeRenumber();
        render();
        toast(changed ? `Renumbered ${plural(changed, 'row')}. Review and save when ready.` : 'Already numbered like that, nothing changed', changed ? 'ok' : '');
    }

    /* ═══════════════════════ Review & save ═══════════════════════ */
    async function openReview() {
        if (state.saving || confirming) return;
        if (!state.edits.size) { toast('No unsaved changes'); return; }

        const invalid = [...state.edits.keys()].map(item).filter(it => FIELDS.some(f => fieldInvalid(it, f)));
        if (invalid.length) {
            toast(`Fix the ${plural(invalid.length, 'highlighted row')} first (empty title or slug, a non-whole number or an incomplete date)`, 'err');
            state.view = 'changed';
            syncViewTabs();
            render();
            tbody.querySelector('.mo-invalid')?.focus();
            return;
        }

        const ids = [...state.edits.keys()].sort((a, b) => order(a) - order(b));
        const slugChanges = ids.filter(id => 'slug' in state.edits.get(id)).length;
        const fieldCount = ids.reduce((n, id) => n + Object.keys(state.edits.get(id)).length, 0);

        // One old -> new entry per changed field, grouped by post.
        const changes = ids.flatMap(id => {
            const it = item(id), e = state.edits.get(id);
            return FIELDS.filter(f => f in e).map(f => ({
                post: `#${id} ${cur(it, 'title')} · ${FIELD_LABEL[f]}`,
                from: String(it[f]),
                to: String(f === 'slug' ? sanitizeSlug(e[f]) : e[f]),
                toLabel: '(empty)',
            }));
        });

        // confirmDialog() shows the message as plain text on one paragraph.
        let message = `${plural(fieldCount, 'field')} across ${plural(ids.length, noun(1), noun(2))} (${typeLabel(state.type)}), written in one go - if any row fails, nothing is written.`;
        if (slugChanges) {
            message = `⚠ ${plural(slugChanges, 'slug')} will change, so those URLs change too. Existing links and search results will 404 unless a redirect is set up. ` + message;
        }
        if (isLiveSite()) message = 'This is the LIVE site. ' + message;

        confirming = true;
        let ok = false;
        try {
            ok = await confirmDialog({
                title: `Save ${plural(ids.length, noun(1), noun(2))}?`,
                message,
                changes,
                okLabel: `Save ${plural(ids.length, noun(1), noun(2))}`,
                cancelLabel: 'Keep editing',
                tone: slugChanges ? 'warn' : 'primary',
            });
        } finally {
            confirming = false;
        }
        if (ok) await save();
    }

    async function save() {
        if (state.saving || !state.edits.size) return;
        state.saving = true;
        const btn = el('mo-review');
        btn.disabled = true;
        btn.textContent = 'Saving…';

        const changes = [...state.edits.entries()].map(([id, e]) => {
            const c = { id, modified: item(id).modified };
            for (const f of FIELDS) if (f in e) c[f] = f === 'slug' ? sanitizeSlug(e[f]) : e[f];
            return c;
        });

        try {
            const data = await api('menu_save.php', {
                method: 'POST',
                body: JSON.stringify({ post_type: state.type, changes }),
            });
            if (data.success) {
                const map = { post_title: 'title', post_name: 'slug', post_date: 'date', menu_order: 'menu_order' };
                const saved = [];
                for (const row of data.items || []) {
                    const it = item(row.id);
                    if (!it) continue;
                    for (const [col, f] of Object.entries(map)) if (col in row) it[f] = col === 'menu_order' ? Number(row[col]) : row[col];
                    if (data.modified) it.modified = data.modified;
                    state.edits.delete(row.id);
                    saved.push(row.id);
                }
                state.errors.clear();
                if (state.view === 'changed') { state.view = 'all'; syncViewTabs(); }
                buildParentFilter();
                render();
                saved.forEach(id => tbody.querySelector(`tr[data-id="${id}"]`)?.classList.add('mo-flash'));
                toast(`Saved ${plural(data.updated || 0, noun(1), noun(2))}`, 'ok');
                if (saved.length && typeof onPostsChanged === 'function') onPostsChanged();
                afterEditsCleared();
            } else if (data.invalid) {
                state.errors = new Map((data.errors || []).map(er => [er.id, er.message]));
                state.view = 'changed';
                syncViewTabs();
                render();
                toast(data.msg || 'Some changes could not be saved - nothing was written', 'err');
            } else {
                toast(data.msg || 'Save failed', 'err');
            }
        } catch (e) {
            toast('Save failed: ' + e.message, 'err');
        } finally {
            state.saving = false;
            btn.disabled = false;
            btn.textContent = 'Review & save';
        }
    }

    /* Discard needs a second click within 3s. That's lighter than a dialog and
       still hard to hit by accident. */
    function discardAll() {
        const btn = el('mo-discard');
        if (!discardArmed) {
            btn.textContent = 'Click again to discard';
            btn.classList.add('mo-armed');
            discardArmed = setTimeout(disarmDiscard, 3000);
            return;
        }
        disarmDiscard();
        state.edits.clear();
        state.errors.clear();
        render();
        toast('All changes discarded', '', 2400);
        afterEditsCleared();
    }

    function disarmDiscard() {
        clearTimeout(discardArmed);
        discardArmed = null;
        const btn = el('mo-discard');
        btn.textContent = 'Discard all';
        btn.classList.remove('mo-armed');
    }

    /* A reload asked for while there were edits runs once they're gone. */
    function afterEditsCleared() {
        if (!state.edits.size && state.staleWhileDirty) loadMenu();
    }

    /* ═══════════════════════ Filters ═══════════════════════ */
    function syncViewTabs() {
        root.querySelectorAll('#mo-view-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    }

    function setSearch(value) {
        state.terms = String(value).toLowerCase().split(/\s+/).filter(Boolean);
        el('mo-searchbox').classList.toggle('mo-has-value', !!value);
    }

    function clearSearch() {
        el('mo-search').value = '';
        setSearch('');
        render();
    }

    function resetFilters() {
        el('mo-search').value = '';
        setSearch('');
        state.view = 'all';
        state.parentFilter = '';
        if (!el('mo-parent-wrap').hidden) el('mo-parent').value = '';
        syncViewTabs();
        render();
    }

    function setSort(s) {
        state.sort = s;
        el('mo-sort').value = s;
        lsSet(LS_SORT, s);
        render();
    }

    /* Switching type would throw edits away, so block it instead. */
    function guardUnsaved(revert) {
        if (!state.edits.size) return true;
        toast(`Save or discard your ${plural(state.edits.size, 'unsaved change')} first`, 'err');
        revert();
        return false;
    }

    /* ═══════════════════════ Events (all scoped to #menuView / own modal) ═══════════════════════ */
    function bindMenuTab() {
        if (bound) return;
        root = el('menuView');
        tbody = el('mo-tbody');
        wrap = el('mo-table-wrap');
        if (!root || !tbody) return;
        bound = true;

        const sort = lsGet(LS_SORT, 'newest');
        if ([...el('mo-sort').options].some(o => o.value === sort)) state.sort = sort;
        el('mo-sort').value = state.sort;

        el('mo-type').addEventListener('change', e => {
            if (!guardUnsaved(() => { e.target.value = state.type; })) return;
            state.type = e.target.value;
            lsSet(lsTypeKey(), state.type);
            state.parentFilter = '';
            loadItems();
        });
        el('mo-parent').addEventListener('change', e => { state.parentFilter = e.target.value; render(); });
        el('mo-sort').addEventListener('change', e => setSort(e.target.value));

        const applySearch = debounce(v => { setSearch(v); render(); }, 120);
        el('mo-search').addEventListener('input', e => {
            el('mo-searchbox').classList.toggle('mo-has-value', !!e.target.value);
            applySearch(e.target.value);
        });
        el('mo-search-clear').addEventListener('click', () => { clearSearch(); el('mo-search').focus(); });

        el('mo-view-tabs').addEventListener('click', e => {
            const b = e.target.closest('.tab');
            if (!b) return;
            state.view = b.dataset.view;
            syncViewTabs();
            render();
        });

        el('mo-renumber').addEventListener('click', openRenumber);
        el('mo-reload').addEventListener('click', () => loadMenu({ fromUser: true }));
        el('mo-review').addEventListener('click', openReview);
        el('mo-discard').addEventListener('click', discardAll);

        // Renumber dialog (outside #menuView, so it has its own listeners)
        const modal = renumberModal();
        ['mo-rn-start', 'mo-rn-step', 'mo-rn-reverse'].forEach(id => {
            el(id).addEventListener('input', updateRenumberPreview);
            el(id).addEventListener('change', updateRenumberPreview);
        });
        el('mo-rn-apply').addEventListener('click', applyRenumber);
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.closest('[data-mo-close]')) closeRenumber();
        });
        modal.addEventListener('keydown', e => {
            // Enter applies - but not on a button (Cancel / × must keep their own meaning).
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !el('mo-rn-apply').disabled) {
                e.preventDefault();
                handledKeys.add(e);
                applyRenumber();
            }
        });

        /* Inline edits */
        tbody.addEventListener('input', e => {
            const f = e.target.dataset.f;
            if (!f) return;
            const id = e.target.closest('tr').dataset.id;
            setField(id, f, e.target.value);
            refreshRowState(id);
        });
        // On commit (blur / Enter): tidy slugs and re-render so sorting, ties and
        // the URL preview catch up.
        tbody.addEventListener('change', e => {
            const f = e.target.dataset.f;
            if (!f) return;
            const id = e.target.closest('tr').dataset.id;
            if (f === 'slug') {
                const clean = sanitizeSlug(e.target.value);
                if (clean && clean !== e.target.value) e.target.value = clean;
                setField(id, f, clean || e.target.value);
            }
            // Deferred: "change" fires on blur, before focus lands on whatever
            // was clicked next - rendering now would rebuild that element away.
            setTimeout(render, 0);
        });
        tbody.addEventListener('keydown', e => {
            const tr = e.target.closest('tr.mo-row');
            if (!tr) return;
            if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                handledKeys.add(e);
                moveBy(tr.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
            } else if (e.key === 'Enter' && e.target.dataset.f) {
                handledKeys.add(e);
                e.target.blur();
            } else if (e.key === 'Escape' && e.target.dataset.f) {
                // Esc inside a field puts that one field back.
                e.preventDefault();
                handledKeys.add(e);
                setField(tr.dataset.id, e.target.dataset.f, item(tr.dataset.id)[e.target.dataset.f]);
                render();
            }
        });
        tbody.addEventListener('pointerdown', e => {
            const h = e.target.closest('[data-drag]');
            if (h && e.button === 0) startDrag(e, h);
        });

        // Delegated actions - scoped to this tab's root only.
        root.addEventListener('click', e => {
            const a = e.target.closest('[data-act]');
            if (!a || !root.contains(a)) return;
            const id = a.closest('tr')?.dataset.id;
            switch (a.dataset.act) {
                case 'up': moveBy(id, -1); break;
                case 'down': moveBy(id, 1); break;
                case 'revert': revertRow(id); break;
                case 'reset': resetFilters(); break;
                case 'sort-order': setSort('order'); break;
                case 'reload': loadMenu({ fromUser: true }); break;
            }
        });
    }

    /**
     * Load (or reload) the type list and the current type's items. Called by
     * app.js the first time the tab is shown and whenever it must reload. With
     * unsaved edits nothing is thrown away: the reload waits until they're
     * saved or discarded.
     */
    async function loadMenu({ fromUser = false } = {}) {
        if (!bound) bindMenuTab();
        if (!root) return;
        if (state.edits.size) {
            state.staleWhileDirty = true;
            updateSummary();
            if (fromUser) toast(`Save or discard your ${plural(state.edits.size, 'unsaved change')} before reloading`, 'warn');
            return;
        }
        if (!state.loaded) state.type = lsGet(lsTypeKey(), 'page');
        if (!state.loaded || fromUser) setLoading();
        try {
            await loadTypes();
        } catch (e) {
            if (isAbort(e)) return;
        }
        await loadItems();
    }

    /** Any element of an open dialog other than ours (help, confirm, Link Fixer, history...). */
    function foreignOverlayOpen() {
        if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return true;
        if (document.body.classList.contains('drawer-open')) return true; // history drawer
        return [...document.querySelectorAll('.fx-modal-overlay.open, .modal-backdrop.open')]
            .some(m => m.id !== 'mo-renumber-modal');
    }

    /**
     * Keyboard while this tab is the active view. Called for every keydown
     * (typing and Esc included). Returns true when the key was handled.
     * Never handles the global keys / ? g h.
     */
    function moHandleKey(e) {
        if (!root || !bound) return false;
        if (handledKeys.has(e)) return true; // already handled by a field / row / renumber listener

        // Ctrl/Cmd+S: review & save; inside our own review dialog it confirms.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key || '').toLowerCase() === 's') {
            if (typeof isConfirmOpen === 'function' && isConfirmOpen()) {
                if (confirming) { e.preventDefault(); closeConfirm(true); return true; }
                return false;
            }
            e.preventDefault(); // never the browser's "Save page"
            if (foreignOverlayOpen() || isRenumberOpen()) return true;
            // Commit a half-typed slug the way blur would.
            if (document.activeElement && tbody.contains(document.activeElement)) document.activeElement.blur();
            openReview();
            return true;
        }

        if (e.key === 'Escape') {
            if (foreignOverlayOpen()) return false;
            if (isRenumberOpen()) { closeRenumber(); return true; }
            if (drag) { return true; }
            const search = el('mo-search');
            if (search.value) { clearSearch(); search.blur(); return true; }
            return false;
        }
        return false;
    }

    function moHasUnsaved() {
        return state.edits.size > 0;
    }

    window.bindMenuTab = bindMenuTab;
    window.loadMenu = loadMenu;
    window.moHandleKey = moHandleKey;
    window.moHasUnsaved = moHasUnsaved;
})();
