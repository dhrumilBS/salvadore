/* ══════════════════════════ Shared UI building blocks ══════════════════════════
 * One implementation of the pieces every list tab needs, so tabs look and
 * behave the same. Loaded after common.js, before the tab scripts.
 *
 *   mdStore             per-browser prefs: mdStore.get(key, fallback, {site}) / .set(key, value, {site})
 *                       keys become "md.<key>" or "md.<site>.<key>"; never throws
 *   mdPager(id, opts)   pagination footer: "Showing a–b of N" + numbered pages + optional rows/page
 *   mdSelection(opts)   Set-based row selection + header checkbox + bulk-bar sync
 *   tableStateRow(cols, msg, kind)   one full-width loading / empty / error row
 */

const mdStore = {
    _key(key, site) { return site ? `md.${SITE || 'default'}.${key}` : `md.${key}`; },
    /** Stored value or `fallback`. Values are JSON; a plain string written by older code is returned as is.
     *  `legacy` = an older key name, read once and moved to the new key. */
    get(key, fallback = null, { site = false, legacy = null } = {}) {
        try {
            const k = this._key(key, site);
            let raw = localStorage.getItem(k);
            if (raw === null && legacy) {
                raw = localStorage.getItem(legacy);
                if (raw !== null) {
                    localStorage.setItem(k, raw);
                    localStorage.removeItem(legacy);
                }
            }
            if (raw === null) return fallback;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        } catch (e) {
            return fallback;
        }
    },
    set(key, value, { site = false } = {}) {
        try { localStorage.setItem(this._key(key, site), JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key, { site = false } = {}) {
        try { localStorage.removeItem(this._key(key, site)); } catch (e) { /* blocked */ }
    },
};

/** `<tr>` spanning the table: kind '' (empty), 'loading' (spinner) or 'error'. `msg` is HTML-escaped unless `html`. */
function tableStateRow(cols, msg, kind = '', { html = false } = {}) {
    const body = (kind === 'loading' ? '<span class="spinner"></span> ' : '') + (html ? msg : escapeHtml(msg));
    return `<tr><td colspan="${cols}" class="state-msg${kind === 'error' ? ' error' : ''}">${body}</td></tr>`;
}

/**
 * Pagination footer rendered into `<div class="pagination md-pager" id="...">`.
 *
 *   const pager = mdPager('cn-pager', { sizes: [50, 100, 250], perPage: 100, noun: 'issue',
 *                                       storeKey: 'cn.perPage', onPage: p => ..., onPerPage: n => ... });
 *   pager.render({ page, total });     // total = rows matching (for the "Showing" text)
 *   pager.render({ page, pages, info }) // server-paged lists can pass pages + their own info HTML
 *   pager.perPage                       // current rows per page
 */
function mdPager(id, { sizes = null, perPage = 50, noun = 'row', storeKey = null, onPage = () => {}, onPerPage = null } = {}) {
    const el = document.getElementById(id);
    if (storeKey && sizes) {
        const saved = Number(mdStore.get(storeKey, perPage));
        if (sizes.includes(saved)) perPage = saved;
    }
    const api = { perPage, page: 1, pages: 1 };

    el.classList.add('pagination', 'md-pager');
    el.innerHTML = `<span class="md-pager-info"></span>
        <div class="md-pager-end">
            ${sizes ? `<select class="md-pager-size" title="Rows per page" aria-label="Rows per page">
                ${sizes.map(n => `<option value="${n}"${n === perPage ? ' selected' : ''}>${n} / page</option>`).join('')}
            </select>` : ''}
            <nav class="md-pager-nav" aria-label="Pages"></nav>
        </div>`;
    const info = el.querySelector('.md-pager-info');
    const nav = el.querySelector('.md-pager-nav');

    nav.addEventListener('click', e => {
        const b = e.target.closest('[data-page]');
        if (b && !b.disabled) onPage(Number(b.dataset.page));
    });
    el.querySelector('.md-pager-size')?.addEventListener('change', e => {
        api.perPage = Number(e.target.value);
        if (storeKey) mdStore.set(storeKey, api.perPage);
        (onPerPage || (() => onPage(1)))(api.perPage);
    });

    api.render = ({ page = 1, total = null, pages = null, info: infoHtml = null } = {}) => {
        pages = Math.max(1, pages ?? Math.ceil((total || 0) / api.perPage));
        page = Math.min(Math.max(1, page), pages);
        api.page = page;
        api.pages = pages;
        if (infoHtml !== null) {
            info.innerHTML = infoHtml;
        } else if (total !== null) {
            const from = total ? (page - 1) * api.perPage + 1 : 0;
            const to = Math.min(total, page * api.perPage);
            info.innerHTML = total
                ? `Showing <b>${fmtNum(from)}–${fmtNum(to)}</b> of <b>${fmtNum(total)}</b> ${escapeHtml(noun)}${total === 1 ? '' : 's'}`
                : `No ${escapeHtml(noun)}s`;
        }
        const btn = (label, p, o = {}) => `<button type="button" class="md-page-btn${o.active ? ' active' : ''}" data-page="${p}"${o.disabled ? ' disabled' : ''}${o.active ? ' aria-current="page"' : ''}${o.title ? ` title="${o.title}"` : ''}>${label}</button>`;
        let html = btn('‹', page - 1, { disabled: page <= 1, title: 'Previous page' });
        const s = Math.max(1, page - 2), e = Math.min(pages, page + 2);
        if (s > 1) { html += btn('1', 1); if (s > 2) html += '<span class="md-page-gap">…</span>'; }
        for (let p = s; p <= e; p++) html += btn(String(p), p, { active: p === page });
        if (e < pages) { if (e < pages - 1) html += '<span class="md-page-gap">…</span>'; html += btn(String(pages), pages); }
        html += btn('›', page + 1, { disabled: page >= pages, title: 'Next page' });
        nav.innerHTML = pages > 1 ? html : '';
        return page;
    };
    return api;
}

/**
 * Row selection kept across pages/reloads (keys = row ids).
 *   const sel = mdSelection({ onChange: () => syncBulkBar() });
 *   sel.toggle(id, on) · sel.setMany(ids, on) · sel.has(id) · sel.size · sel.clear() · sel.ids()
 *   sel.prune(validIds)             drop ids no longer in the data
 *   sel.syncHeader(checkbox, pageIds)  checked / indeterminate state of a select-all box
 */
function mdSelection({ onChange = () => {} } = {}) {
    const set = new Set();
    return {
        has: id => set.has(id),
        get size() { return set.size; },
        ids: () => [...set],
        toggle(id, on = !set.has(id)) { if (on) set.add(id); else set.delete(id); onChange(); },
        setMany(ids, on) { ids.forEach(id => (on ? set.add(id) : set.delete(id))); onChange(); },
        clear() { if (set.size) { set.clear(); onChange(); } },
        prune(validIds) {
            const keep = new Set(validIds);
            let changed = false;
            [...set].forEach(id => { if (!keep.has(id)) { set.delete(id); changed = true; } });
            if (changed) onChange();
        },
        syncHeader(cb, pageIds) {
            if (!cb) return;
            const n = pageIds.filter(id => set.has(id)).length;
            cb.checked = pageIds.length > 0 && n === pageIds.length;
            cb.indeterminate = n > 0 && n < pageIds.length;
        },
    };
}
