/* ══════════════════════════ Template Pages ══════════════════════════
 * Every page built on a WordPress page template (state pages + their linked
 * city pages) on healthray.com. Replaces the old StateCity Browser, Template
 * Explorer and keyphrase.php pages.
 *
 *   api/list_templates.php    pages of one template (parents + cityData children)
 *   api/check_url_status.php  live HTTP status of one healthray.com URL
 *   api/bulk_update_post.php  save title / slug / status of one or more pages
 *
 * Nothing saves on its own: edits are staged (amber), then saved per row
 * (Save / Enter) or all at once (Review & save, Ctrl+S). A slug change or a
 * move to trash always asks first, because it changes what's live.
 */

const API = {
    list: 'api/list_templates.php',
    check: 'api/check_url_status.php',
    save: 'api/bulk_update_post.php',
};
const SITE = 'https://healthray.com';
const STATUSES = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];
// Below the browser's ~6 connections per origin, so a Save still gets through while checks run.
const CHECK_CONCURRENCY = 4;
const COLLAPSE_OVER = 60; // start with city pages folded away when there are more than this
const SLUG_RE = /^[a-z0-9\-_%]+$/;
const FIELDS = { title: 'Title', slug: 'Slug', status: 'Status' };
const URL_CATS = [['ok', '200 OK'], ['redirect', 'Redirect'], ['gone', '410 Gone'], ['missing', '404 Not found'], ['error', 'Error'], ['unknown', 'Other code']];
const ISSUE_CATS = new Set(['redirect', 'gone', 'missing', 'error', 'unknown']);

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const fmt = n => Number(n).toLocaleString();
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
const liveUrl = slug => `${SITE}/${slug}/`;
const shortUrl = u => (u || '').replace(/^https?:\/\/(www\.)?healthray\.com/i, '') || '/';

const state = {
    template: 'HIMS',
    best: 'hms',
    pages: [],            // flat, in API order: parent, its children, next parent, …
    collapsed: new Set(), // keys of parents whose children are folded away
    selected: new Set(),  // page keys
    q: '',
    status: '',
    urlFilter: '',        // '' | 'issues' | 'unchecked' | a URL_CATS key
    sort: null,           // { key, dir }
    check: null,          // running URL check: { abort, done, total }
    loadSeq: 0,
    loadAbort: null,
    saving: false,
};

/* ───── helpers ───── */
function toast(message, ok = true) {
    const el = document.createElement('div');
    el.className = `toast-item ${ok ? 'is-ok' : 'is-err'}`;
    el.textContent = message;
    $('toastStack').appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => { el.classList.remove('is-visible'); setTimeout(() => el.remove(), 250); }, ok ? 3500 : 6000);
}

/** Modal confirm; resolves true on OK. */
function confirmBox({ title, html, okLabel = 'OK', tone = 'primary' }) {
    const dlg = $('confirmDlg');
    $('dlgTitle').textContent = title;
    $('dlgBody').innerHTML = html;
    $('dlgOk').textContent = okLabel;
    $('dlgOk').className = `btn btn-${tone}`;
    dlg.returnValue = '';
    dlg.showModal();
    $('dlgOk').focus();
    return new Promise(resolve => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

function copyText(text) {
    // navigator.clipboard only exists on https/localhost; the LAN address is plain http.
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        ok ? resolve() : reject(new Error('copy failed'));
    });
}

/* ───── model ───── */
function makePage(e, parent, label, template) {
    const cur = { title: e.post_title ?? '', slug: e.post_name ?? '', status: e.post_status ?? 'publish' };
    return {
        key: 0, id: String(e.id), parent, label, template: template || '',
        order: e.menu_order ?? '', canonical: e.canonical || '',
        orig: { ...cur }, cur, url: null, children: [], tr: null,
    };
}

function buildPages(data) {
    const pages = [];
    data.forEach((row, i) => {
        const parent = makePage(row, null, String(i + 1), row.template);
        pages.push(parent);
        (row.cityData || []).forEach((c, j) => {
            const child = makePage(c, parent, `${i + 1}.${j + 1}`, row.template);
            parent.children.push(child);
            pages.push(child);
        });
    });
    pages.forEach((p, i) => { p.key = i; });
    return pages;
}

const changedFields = p => Object.keys(FIELDS).filter(f => p.cur[f] !== p.orig[f]);
const isDirty = p => changedFields(p).length > 0;
const dirtyPages = () => state.pages.filter(isDirty);
const slugOk = p => SLUG_RE.test(p.cur.slug);
const rowOk = p => slugOk(p) && p.cur.title.trim() !== '';
const pageByKey = key => state.pages[Number(key)];
const pageOf = el => pageByKey(el.closest('tr')?.dataset.key);

/* ───── rendering ───── */
function statusOptions(current) {
    return STATUSES.map(s => `<option value="${s}"${s === current ? ' selected' : ''}>${s}</option>`).join('');
}

function canonicalHtml(p) {
    const c = p.canonical.trim();
    if (!c) return '<span class="muted">self</span>';
    if (c.replace(/\/?$/, '/') === liveUrl(p.orig.slug)) return '<span class="muted" title="Set explicitly, same as the page URL">self</span>';
    return `<a class="canon-other" href="${esc(c)}" target="_blank" rel="noopener" title="Canonical points to another URL: ${esc(c)}">${esc(shortUrl(c))}</a>`;
}

function urlBadge(r) {
    if (!r) return '<span class="ubadge pending">Not checked</span>';
    if (r.checking) return '<span class="ubadge pending">Checking…</span>';
    const label = { ok: '200 OK', redirect: `${r.code} Redirect`, gone: '410 Gone', missing: '404 Not found', error: r.code ? `${r.code} Error` : 'Error' }[r.cat] || String(r.code);
    return `<span class="ubadge ${r.cat}"${r.error ? ` title="${esc(r.error)}"` : ''}>${label}</span>`;
}

function urlCellHtml(p) {
    const r = p.url;
    return `<button type="button" class="icon-btn${r?.checking ? ' spinning' : ''}" data-act="check" title="Check this URL now"${r?.checking ? ' disabled' : ''}>⟳</button>`
        + urlBadge(r)
        + (r?.redirect ? `<div class="redirect-to">→ <a href="${esc(r.redirect)}" target="_blank" rel="noopener" title="${esc(r.redirect)}">${esc(shortUrl(r.redirect))}</a></div>` : '');
}

function rowHtml(p) {
    const kids = p.children.length;
    const open = !state.collapsed.has(p.key);
    const caret = kids
        ? `<button type="button" class="caret" data-act="toggle" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} its ${plural(kids, 'child page')}">${open ? '▾' : '▸'} <span>${fmt(kids)}</span></button>`
        : '';
    return `<tr data-key="${p.key}" class="${p.parent ? 'is-child' : 'is-parent'}">
        <td class="c-check"><input type="checkbox" class="form-check-input row-check" aria-label="Select page ${esc(p.id)}"${state.selected.has(p.key) ? ' checked' : ''}></td>
        <td class="c-idx"><span class="idx">${esc(p.label)}</span>${caret}</td>
        <td class="c-id"><a href="${SITE}/wp-admin/post.php?post=${encodeURIComponent(p.id)}&action=edit" target="_blank" rel="noopener" title="Edit in WordPress">${esc(p.id)}</a></td>
        <td class="c-title"><input class="form-control form-control-sm field" data-f="title" value="${esc(p.cur.title)}" aria-label="Title"></td>
        <td class="c-slug"><div class="slug-wrap"><input class="form-control form-control-sm field mono" data-f="slug" value="${esc(p.cur.slug)}" aria-label="Slug" spellcheck="false"><a class="open-link" href="${esc(liveUrl(p.orig.slug))}" target="_blank" rel="noopener" title="Open the live page">↗</a></div></td>
        <td class="c-status"><select class="form-select form-select-sm field st st-${esc(p.cur.status)}" data-f="status" aria-label="Status">${statusOptions(p.cur.status)}</select></td>
        <td class="c-order num">${esc(p.order)}</td>
        <td class="c-tpl"><span class="tpl-tag">${esc(p.template)}</span></td>
        <td class="c-url">${urlCellHtml(p)}</td>
        <td class="c-canon">${canonicalHtml(p)}</td>
        <td class="c-act"><button type="button" class="btn btn-sm btn-warning" data-act="save" hidden>Save</button><button type="button" class="icon-btn" data-act="revert" title="Undo this row's changes" hidden>↺</button></td>
    </tr>`;
}

function renderTable() {
    const tbody = $('tbody');
    tbody.innerHTML = state.pages.map(rowHtml).join('');
    [...tbody.children].forEach((tr, i) => { state.pages[i].tr = tr; });
    // The template column only says something when several templates are listed.
    const tpls = new Set(state.pages.map(p => p.template));
    $('table').classList.toggle('hide-tpl', tpls.size <= 1);
    state.pages.forEach(refreshRow);
    placeRows();
    applyView();
    renderChips();
    updateBar();
    updateSortHeaders();
}

/** Re-sync one row's inputs + dirty/invalid markers with p.cur. */
function refreshRow(p) {
    const tr = p.tr;
    if (!tr) return;
    Object.keys(FIELDS).forEach(f => {
        const el = tr.querySelector(`[data-f="${f}"]`);
        if (el.value !== p.cur[f]) el.value = p.cur[f];
        el.classList.toggle('is-changed', p.cur[f] !== p.orig[f]);
    });
    const st = tr.querySelector('[data-f="status"]');
    st.className = st.className.replace(/\bst-\S+/g, '').trim() + ` st-${p.cur.status}`;
    tr.querySelector('[data-f="slug"]').classList.toggle('is-invalid', !slugOk(p));
    tr.querySelector('[data-f="title"]').classList.toggle('is-invalid', p.cur.title.trim() === '');
    const dirty = isDirty(p);
    tr.classList.toggle('is-dirty', dirty);
    tr.querySelector('[data-act="save"]').hidden = !dirty;
    tr.querySelector('[data-act="revert"]').hidden = !dirty;
}

function paintUrl(p) {
    if (p.tr) p.tr.querySelector('.c-url').innerHTML = urlCellHtml(p);
}

/* ───── filtering / sorting ───── */
const filtersActive = () => !!(state.q || state.status || state.urlFilter);

function matches(p) {
    if (state.q) {
        const hay = `${p.id} ${p.cur.title} ${p.cur.slug} ${p.cur.status} ${p.template} ${p.canonical} ${p.url?.redirect || ''}`.toLowerCase();
        if (!hay.includes(state.q)) return false;
    }
    if (state.status && p.cur.status !== state.status) return false;
    const f = state.urlFilter;
    if (f === 'issues') return !!p.url && ISSUE_CATS.has(p.url.cat);
    if (f === 'unchecked') return !p.url || !!p.url.checking;
    if (f) return p.url?.cat === f;
    return true;
}

function applyView() {
    const filtering = filtersActive();
    const shown = new Set();
    const context = new Set(); // parents shown dimmed so a matching city page keeps its state
    state.pages.forEach(p => {
        if (filtering) {
            if (matches(p)) {
                shown.add(p);
                if (p.parent && !state.sort) context.add(p.parent);
            }
        } else if (!p.parent || state.sort || !state.collapsed.has(p.parent.key)) {
            shown.add(p);
        }
    });
    state.pages.forEach(p => {
        p.tr.hidden = !shown.has(p) && !context.has(p);
        p.tr.classList.toggle('is-context', !shown.has(p) && context.has(p));
    });

    $('statShown').textContent = fmt(shown.size);
    $('clearFiltersBtn').hidden = !filtering;
    const anyCollapsed = state.pages.some(p => p.children.length && state.collapsed.has(p.key));
    $('expandBtn').textContent = anyCollapsed ? 'Expand all' : 'Collapse all';
    $('expandBtn').disabled = filtering || !!state.sort || !state.pages.some(p => p.children.length);

    const msg = $('tableMsg');
    if (!state.pages.length) {
        msg.innerHTML = '<div class="empty"><b>No pages use this template.</b><span>Pick another template above.</span></div>';
    } else if (!shown.size) {
        msg.innerHTML = '<div class="empty"><b>Nothing matches these filters.</b><button type="button" class="btn btn-link btn-sm" data-act="clear-filters">Clear filters</button></div>';
    } else {
        msg.innerHTML = '';
    }
    syncSelectAll();
}

const SORTERS = {
    id: p => Number(p.id),
    title: p => p.cur.title.toLowerCase(),
    slug: p => p.cur.slug,
    status: p => p.cur.status,
    order: p => Number(p.order) || 0,
    template: p => p.template,
    url: p => (p.url && !p.url.checking ? p.url.code : -1),
    canonical: p => p.canonical,
};

/** Put the rows in display order: API order (hierarchy), or flat by the sorted column. */
function placeRows() {
    let list = state.pages;
    if (state.sort) {
        const { key, dir } = state.sort;
        const val = SORTERS[key];
        list = [...state.pages].sort((a, b) => {
            const x = val(a), y = val(b);
            return (x < y ? -1 : x > y ? 1 : 0) * dir || a.key - b.key;
        });
    }
    const frag = document.createDocumentFragment();
    list.forEach(p => frag.appendChild(p.tr));
    $('tbody').appendChild(frag);
    $('table').classList.toggle('is-sorted', !!state.sort);
}

function updateSortHeaders() {
    document.querySelectorAll('#table th[data-sort]').forEach(th => {
        const on = state.sort?.key === th.dataset.sort;
        th.setAttribute('aria-sort', on ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
        th.title = on ? 'Sorted - click again to reverse, a third time to restore the page tree' : 'Sort by this column';
    });
}

/* ───── stats, chips, action bar ───── */
function renderStats() {
    const parents = state.pages.filter(p => !p.parent).length;
    $('statParents').textContent = fmt(parents);
    $('statChildren').textContent = fmt(state.pages.length - parents);
}

function renderChips() {
    const counts = {};
    let checked = 0, issues = 0;
    state.pages.forEach(p => {
        if (!p.url || p.url.checking) return;
        checked++;
        counts[p.url.cat] = (counts[p.url.cat] || 0) + 1;
        if (ISSUE_CATS.has(p.url.cat)) issues++;
    });
    const box = $('urlChips');
    if (!state.pages.length) { box.innerHTML = ''; return; }
    if (!checked && !state.check) {
        box.innerHTML = '<span class="muted">Live status not checked yet — press <b>Check URLs</b> to find redirects, 404s and 410s.</span>';
        return;
    }
    const chip = (key, label, n, cls) => {
        const on = state.urlFilter === key;
        return `<button type="button" class="chip ${cls}${on ? ' on' : ''}" data-url-filter="${key}" aria-pressed="${on}"${!n && !on ? ' disabled' : ''}>${label}<b>${fmt(n)}</b></button>`;
    };
    box.innerHTML = [
        chip('issues', 'Needs attention', issues, 'chip-issues'),
        ...URL_CATS.filter(([k]) => counts[k]).map(([k, label]) => chip(k, label, counts[k], `chip-${k}`)),
        chip('unchecked', 'Not checked', state.pages.length - checked, 'chip-unchecked'),
    ].join('');
}

let chipsQueued = false;
function scheduleChips() {
    if (chipsQueued) return;
    chipsQueued = true;
    requestAnimationFrame(() => { chipsQueued = false; renderChips(); });
}

function updateBar() {
    const dirty = dirtyPages().length;
    const sel = state.selected.size;
    $('dirtyCount').textContent = fmt(dirty);
    $('selCount').textContent = fmt(sel);
    $('dirtyBox').hidden = !dirty;
    $('selBox').hidden = !sel;
    $('actionBar').hidden = !dirty && !sel;
    $('statDirty').textContent = fmt(dirty);
    $('statDirtyBox').hidden = !dirty;
    $('saveAllBtn').disabled = state.saving;
    document.body.classList.toggle('has-bar', !!(dirty || sel));
}

function syncSelectAll() {
    const visible = state.pages.filter(p => !p.tr.hidden && !p.tr.classList.contains('is-context'));
    const all = $('selectAll');
    const n = visible.filter(p => state.selected.has(p.key)).length;
    all.checked = visible.length > 0 && n === visible.length;
    all.indeterminate = n > 0 && n < visible.length;
}

function updateCheckBtn() {
    const btn = $('checkBtn');
    if (state.check) {
        btn.textContent = `Stop (${fmt(state.check.done)} / ${fmt(state.check.total)})`;
        btn.classList.replace('btn-primary', 'btn-outline-danger');
    } else {
        btn.textContent = filtersActive() ? 'Check shown URLs' : 'Check URLs';
        btn.classList.replace('btn-outline-danger', 'btn-primary');
    }
}

/* ───── loading ───── */
const TEMPLATE_LABEL = () => {
    const opt = $('templateSelect').selectedOptions[0];
    return state.template === 'META' ? `Meta · ${state.best.toUpperCase()}` : (opt ? opt.textContent : state.template);
};

function syncQuery() {
    const qs = new URLSearchParams({ template: state.template });
    if (state.template === 'META') qs.set('best', state.best);
    history.replaceState(null, '', `?${qs}`);
}

async function load() {
    const seq = ++state.loadSeq;
    state.loadAbort?.abort();
    state.loadAbort = new AbortController();
    stopCheck();
    $('bestWrap').hidden = state.template !== 'META';
    $('heading').textContent = TEMPLATE_LABEL();
    $('subheading').textContent = 'Loading pages…';
    $('tbody').innerHTML = '';
    state.pages = [];
    $('tableMsg').innerHTML = '<div class="empty"><span class="spinner"></span><span>Loading pages…</span></div>';
    $('urlChips').innerHTML = '';
    $('reloadBtn').disabled = true;

    try {
        const qs = new URLSearchParams({ template: state.template });
        if (state.template === 'META') qs.set('best', state.best);
        const res = await fetch(`${API.list}?${qs}`, { signal: state.loadAbort.signal });
        const json = await res.json().catch(() => null);
        if (seq !== state.loadSeq) return;
        if (!res.ok || !json || !json.success) throw new Error(json?.error || json?.msg || `The server answered ${res.status}`);

        state.pages = buildPages(json.data || []);
        state.selected.clear();
        state.sort = null;
        const children = state.pages.filter(p => p.parent).length;
        state.collapsed = new Set(children > COLLAPSE_OVER ? state.pages.filter(p => p.children.length).map(p => p.key) : []);
        renderStats();
        $('subheading').textContent = state.pages.length
            ? `${plural(state.pages.length - children, 'parent page')}${children ? ` with ${plural(children, 'child page')}` : ''}`
            : '';
        renderTable();
    } catch (err) {
        if (err.name === 'AbortError' || seq !== state.loadSeq) return;
        renderStats();
        $('subheading').textContent = '';
        $('tableMsg').innerHTML = `<div class="empty is-error"><b>Couldn't load the pages.</b><span>${esc(err.message)}</span><button type="button" class="btn btn-outline-secondary btn-sm" data-act="retry">Try again</button></div>`;
    } finally {
        if (seq === state.loadSeq) $('reloadBtn').disabled = false;
        updateCheckBtn();
    }
}

async function switchTemplate() {
    const dirty = dirtyPages().length;
    if (dirty && !await confirmBox({
        title: 'Discard unsaved changes?',
        html: `<p>You have ${plural(dirty, 'unsaved change')} on this list. Switching the template throws them away.</p>`,
        okLabel: 'Discard and switch', tone: 'danger',
    })) {
        $('templateSelect').value = state.template;
        $('bestSelect').value = state.best;
        return;
    }
    state.template = $('templateSelect').value;
    state.best = $('bestSelect').value;
    syncQuery();
    load();
}

/* ───── live URL checks ───── */
function categorize(j) {
    if (!j.success) return 'error';
    if (j.is_gone) return 'gone';
    if (j.is_not_found) return 'missing';
    if (j.is_redirect) return 'redirect';
    if (j.is_error || !j.status_code) return 'error';
    return j.status_code === 200 ? 'ok' : 'unknown';
}

async function checkPage(p, signal) {
    if (!p.orig.slug) {
        p.url = { cat: 'error', code: 0, redirect: '', error: 'This page has no slug' };
        paintUrl(p);
        return;
    }
    p.url = { checking: true };
    paintUrl(p);
    try {
        const res = await fetch(`${API.check}?url=${encodeURIComponent(liveUrl(p.orig.slug))}`, { signal });
        const j = await res.json();
        p.url = { cat: categorize(j), code: j.status_code || 0, redirect: j.redirect_url || '', error: j.success ? '' : (j.error || j.msg || 'Check failed') };
    } catch (err) {
        p.url = err.name === 'AbortError' ? null : { cat: 'error', code: 0, redirect: '', error: err.message };
    }
    paintUrl(p);
    scheduleChips();
}

function stopCheck() {
    if (state.check) state.check.abort.abort();
}

async function checkUrls() {
    if (state.check) { stopCheck(); return; }
    const list = filtersActive() ? state.pages.filter(matches) : state.pages;
    if (!list.length) { toast('No pages to check', false); return; }
    const abort = new AbortController();
    const run = { abort, done: 0, total: list.length };
    state.check = run;
    updateCheckBtn();
    renderChips();

    let next = 0;
    const worker = async () => {
        while (next < list.length && !abort.signal.aborted) {
            await checkPage(list[next++], abort.signal);
            run.done++;
            if (state.check === run) updateCheckBtn();
        }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, list.length) }, worker));
    if (state.check !== run) return; // a reload replaced the list meanwhile
    state.check = null;
    updateCheckBtn();
    renderChips();
    if (state.urlFilter) applyView();

    const issues = list.filter(p => p.url && ISSUE_CATS.has(p.url.cat)).length;
    if (abort.signal.aborted) toast(`Stopped after ${plural(run.done, 'URL')}`);
    else toast(issues ? `${plural(run.total, 'URL')} checked — ${fmt(issues)} need attention` : `${plural(run.total, 'URL')} checked — all OK`, !issues);
}

async function checkAdhoc(e) {
    e.preventDefault();
    const raw = $('adhocInput').value.trim();
    const out = $('adhocResult');
    if (!raw) { $('adhocInput').focus(); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : liveUrl(raw.replace(/^\/+|\/+$/g, ''));
    out.innerHTML = urlBadge({ checking: true });
    try {
        const j = await (await fetch(`${API.check}?url=${encodeURIComponent(url)}`)).json();
        const r = { cat: categorize(j), code: j.status_code || 0, redirect: j.redirect_url || '', error: j.success ? '' : (j.error || j.msg) };
        out.innerHTML = urlBadge(r) + (r.redirect ? ` <span class="redirect-to">→ ${esc(shortUrl(r.redirect))}</span>` : '') + (r.error ? ` <span class="muted">${esc(r.error)}</span>` : '');
    } catch (err) {
        out.innerHTML = `<span class="ubadge error">Error</span> <span class="muted">${esc(err.message)}</span>`;
    }
}

/* ───── saving ───── */
function changesHtml(list) {
    const MAX = 200;
    const items = list.slice(0, MAX).map(p => `<li>
        <span class="dlg-page">#${esc(p.id)} ${esc(p.orig.title)}</span>
        ${changedFields(p).map(f => `<div><span class="dlg-field">${FIELDS[f]}</span>
            <span class="dlg-from">${esc(p.orig[f]) || '<em>empty</em>'}</span> → <span class="dlg-to">${esc(p.cur[f]) || '<em>empty</em>'}</span></div>`).join('')}
    </li>`);
    return `<ul class="dlg-changes">${items.join('')}</ul>`
        + (list.length > MAX ? `<p class="muted">…and ${plural(list.length - MAX, 'more page')}.</p>` : '');
}

async function saveRows(list, { ask = true } = {}) {
    if (state.saving) return;
    list = list.filter(isDirty);
    if (!list.length) return;
    const bad = list.filter(p => !rowOk(p));
    if (bad.length) {
        toast(`Fix ${plural(bad.length, 'row')} first: a title can't be empty, and a slug may only use a-z, 0-9, - and _`, false);
        const first = bad[0];
        if (first.tr.hidden) { state.collapsed.delete(first.parent?.key); applyView(); }
        first.tr.querySelector('.is-invalid')?.focus();
        return;
    }
    const slugChanges = list.filter(p => p.cur.slug !== p.orig.slug).length;
    const trashed = list.filter(p => p.cur.status === 'trash' && p.orig.status !== 'trash').length;
    if (ask || slugChanges || trashed) {
        const warn = [
            slugChanges ? `<p class="dlg-warn"><b>New slug on ${plural(slugChanges, 'page')}:</b> the old URL stops working. Add a redirect for it in Master Dashboard → Redirects.</p>` : '',
            trashed ? `<p class="dlg-warn danger"><b>${plural(trashed, 'page')} will be moved to trash</b> and go offline.</p>` : '',
        ].join('');
        const ok = await confirmBox({
            title: `Save ${plural(list.length, 'page')} on healthray.com?`,
            html: warn + changesHtml(list),
            okLabel: list.length === 1 ? 'Save page' : `Save ${fmt(list.length)} pages`,
            tone: trashed ? 'danger' : 'primary',
        });
        if (!ok) return;
    }

    state.saving = true;
    updateBar();
    list.forEach(p => p.tr.querySelector('[data-act="save"]').disabled = true);
    try {
        const payload = list.map(p => ({ id: p.id, post_title: p.cur.title.trim(), post_name: p.cur.slug, post_status: p.cur.status }));
        const res = await fetch(API.save, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Template-Pages': '1' },
            body: new URLSearchParams({ posts: JSON.stringify(payload) }),
        });
        const json = await res.json().catch(() => null);
        if (!json) throw new Error(`The server answered ${res.status}`);
        if (!json.success) throw new Error(json.msg);
        list.forEach(p => {
            const slugChanged = p.cur.slug !== p.orig.slug;
            p.cur.title = p.cur.title.trim();
            p.orig = { ...p.cur };
            if (slugChanged) {
                p.url = null;
                p.tr.querySelector('.open-link').href = liveUrl(p.orig.slug);
                p.tr.querySelector('.c-canon').innerHTML = canonicalHtml(p);
                paintUrl(p);
            }
            refreshRow(p);
        });
        renderChips();
        toast(json.msg || 'Saved');
    } catch (err) {
        toast(`Nothing saved — ${err.message}`, false);
    } finally {
        state.saving = false;
        list.forEach(p => p.tr.querySelector('[data-act="save"]').disabled = false);
        updateBar();
        if (state.status) applyView();
    }
}

function revert(p, field) {
    (field ? [field] : Object.keys(FIELDS)).forEach(f => { p.cur[f] = p.orig[f]; });
    refreshRow(p);
    updateBar();
}

async function discardAll() {
    const list = dirtyPages();
    if (!list.length) return;
    const ok = await confirmBox({ title: 'Discard all unsaved changes?', html: changesHtml(list), okLabel: 'Discard', tone: 'danger' });
    if (!ok) return;
    list.forEach(p => revert(p));
    toast(`${plural(list.length, 'row')} reverted`);
}

/* ───── export ───── */
function exportCsv() {
    // Table order (sorted or tree), every row matching the filters - folded city pages included.
    const list = [...$('tbody').children].map(tr => pageByKey(tr.dataset.key)).filter(p => !filtersActive() || matches(p));
    if (!list.length) { toast('No rows to export', false); return; }
    const cell = v => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a cell run as an Excel formula
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['#', 'Type', 'Parent ID', 'ID', 'Template', 'Title', 'Slug', 'Status', 'Order', 'Live URL', 'Canonical', 'URL status', 'Redirect target'];
    const rows = list.map(p => [
        p.label, p.parent ? 'Child' : 'Parent', p.parent?.id || '', p.id, p.template, p.cur.title, p.cur.slug, p.cur.status, p.order,
        liveUrl(p.orig.slug), p.canonical, p.url && !p.url.checking ? (p.url.code || p.url.error || 'Error') : '', p.url?.redirect || '',
    ]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        download: `template-pages-${(state.template === 'META' ? `meta-${state.best}` : state.template).toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${plural(list.length, 'row')}`);
}

function copyJson() {
    if (!state.pages.length) { toast('Nothing loaded to copy', false); return; }
    const out = p => ({ id: p.id, post_title: p.cur.title, post_name: p.cur.slug, post_status: p.cur.status, menu_order: p.order, canonical: p.canonical, url: liveUrl(p.orig.slug) });
    const data = state.pages.filter(p => !p.parent).map(p => ({ ...out(p), template: p.template, cityData: p.children.map(out) }));
    copyText(JSON.stringify(data, null, 2))
        .then(() => toast(`Copied ${plural(state.pages.length, 'page')} as JSON`))
        .catch(() => toast('Could not copy — the browser blocked the clipboard', false));
}

/* ───── events ───── */
function bind() {
    $('templateSelect').addEventListener('change', switchTemplate);
    $('bestSelect').addEventListener('change', switchTemplate);
    $('reloadBtn').addEventListener('click', async () => {
        const dirty = dirtyPages().length;
        if (dirty && !await confirmBox({ title: 'Reload and discard changes?', html: `<p>${plural(dirty, 'unsaved change')} will be lost.</p>`, okLabel: 'Reload', tone: 'danger' })) return;
        load();
    });
    $('checkBtn').addEventListener('click', checkUrls);
    $('csvBtn').addEventListener('click', exportCsv);
    $('jsonBtn').addEventListener('click', copyJson);
    $('adhocForm').addEventListener('submit', checkAdhoc);

    let searchTimer;
    $('searchInput').addEventListener('input', e => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); applyView(); updateCheckBtn(); }, 150);
    });
    $('searchInput').addEventListener('keydown', e => {
        if (e.key === 'Escape' && e.target.value) { e.target.value = ''; state.q = ''; applyView(); updateCheckBtn(); }
    });
    $('statusFilter').addEventListener('change', e => { state.status = e.target.value; applyView(); updateCheckBtn(); });
    $('urlChips').addEventListener('click', e => {
        const chip = e.target.closest('[data-url-filter]');
        if (!chip) return;
        state.urlFilter = state.urlFilter === chip.dataset.urlFilter ? '' : chip.dataset.urlFilter;
        renderChips();
        applyView();
        updateCheckBtn();
    });
    const clearFilters = () => {
        state.q = ''; state.status = ''; state.urlFilter = '';
        $('searchInput').value = ''; $('statusFilter').value = '';
        renderChips(); applyView(); updateCheckBtn();
    };
    $('clearFiltersBtn').addEventListener('click', clearFilters);
    $('tableMsg').addEventListener('click', e => {
        if (e.target.closest('[data-act="clear-filters"]')) clearFilters();
        if (e.target.closest('[data-act="retry"]')) load();
    });

    $('expandBtn').addEventListener('click', () => {
        const parents = state.pages.filter(p => p.children.length);
        const anyCollapsed = parents.some(p => state.collapsed.has(p.key));
        state.collapsed = new Set(anyCollapsed ? [] : parents.map(p => p.key));
        parents.forEach(p => {
            const b = p.tr.querySelector('[data-act="toggle"]');
            b.setAttribute('aria-expanded', String(anyCollapsed));
            b.firstChild.textContent = anyCollapsed ? '▾ ' : '▸ ';
        });
        applyView();
    });

    document.querySelectorAll('#table th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort?.key !== key) state.sort = { key, dir: 1 };
        else if (state.sort.dir === 1) state.sort.dir = -1;
        else state.sort = null;
        placeRows();
        applyView();
        updateSortHeaders();
    }));

    $('selectAll').addEventListener('change', e => {
        state.pages.forEach(p => {
            if (p.tr.hidden || p.tr.classList.contains('is-context')) return;
            e.target.checked ? state.selected.add(p.key) : state.selected.delete(p.key);
            p.tr.querySelector('.row-check').checked = e.target.checked;
        });
        updateBar();
        syncSelectAll();
    });

    const tbody = $('tbody');
    tbody.addEventListener('input', e => {
        const f = e.target.dataset.f;
        if (!f) return;
        const p = pageOf(e.target);
        p.cur[f] = e.target.value;
        refreshRow(p);
        updateBar();
    });
    tbody.addEventListener('change', e => {
        if (e.target.dataset.f === 'slug') {
            // Tidy on leaving the field: WordPress slugs are lowercase with dashes.
            const p = pageOf(e.target);
            p.cur.slug = p.cur.slug.trim().toLowerCase().replace(/\s+/g, '-');
            refreshRow(p);
            updateBar();
        } else if (e.target.classList.contains('row-check')) {
            const p = pageOf(e.target);
            e.target.checked ? state.selected.add(p.key) : state.selected.delete(p.key);
            updateBar();
            syncSelectAll();
        }
    });
    tbody.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const p = pageOf(btn);
        switch (btn.dataset.act) {
            case 'save': saveRows([p], { ask: false }); break;
            case 'revert': revert(p); break;
            case 'check': checkPage(p).then(() => { if (state.urlFilter) applyView(); }); break;
            case 'toggle': {
                const open = state.collapsed.has(p.key);
                open ? state.collapsed.delete(p.key) : state.collapsed.add(p.key);
                btn.setAttribute('aria-expanded', String(open));
                btn.firstChild.textContent = open ? '▾ ' : '▸ ';
                btn.title = `${open ? 'Hide' : 'Show'} its ${plural(p.children.length, 'child page')}`;
                applyView();
                break;
            }
        }
    });
    tbody.addEventListener('keydown', e => {
        const f = e.target.dataset.f;
        if (!f) return;
        const p = pageOf(e.target);
        if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); saveRows([p], { ask: false }); }
        if (e.key === 'Escape') { revert(p, f); e.target.blur(); }
    });

    $('bulkApplyBtn').addEventListener('click', () => {
        const status = $('bulkStatus').value;
        const list = [...state.selected].map(pageByKey);
        list.forEach(p => { p.cur.status = status; refreshRow(p); });
        updateBar();
        toast(`Status "${status}" staged on ${plural(list.length, 'row')} — press Review & save to save`);
    });
    $('selClearBtn').addEventListener('click', () => {
        state.selected.clear();
        tbody.querySelectorAll('.row-check:checked').forEach(c => { c.checked = false; });
        updateBar();
        syncSelectAll();
    });
    $('saveAllBtn').addEventListener('click', () => saveRows(dirtyPages()));
    $('discardBtn').addEventListener('click', discardAll);

    document.addEventListener('keydown', e => {
        if ($('confirmDlg').open) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (dirtyPages().length) saveRows(dirtyPages());
            return;
        }
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
        if (e.key === '/' && !typing) { e.preventDefault(); $('searchInput').focus(); }
    });
    window.addEventListener('beforeunload', e => {
        if (dirtyPages().length) { e.preventDefault(); e.returnValue = ''; }
    });
}

/* ───── start ───── */
(function init() {
    bind();
    const qs = new URLSearchParams(location.search);
    const t = qs.get('template');
    if (t && [...$('templateSelect').options].some(o => o.value.toLowerCase() === t.toLowerCase())) {
        state.template = [...$('templateSelect').options].find(o => o.value.toLowerCase() === t.toLowerCase()).value;
    }
    const b = (qs.get('best') || '').toLowerCase();
    if ([...$('bestSelect').options].some(o => o.value === b)) state.best = b;
    $('templateSelect').value = state.template;
    $('bestSelect').value = state.best;
    load();
})();
