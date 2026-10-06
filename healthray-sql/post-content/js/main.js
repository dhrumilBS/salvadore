/* ═══════════════════════════════════════════════════════════
   Link Checker — main.js (v4)

   · URLs are never truncated. Every URL (and every redirect target) is
     rendered in full, in a monospace face, split into scheme / host / path.
   · Redirect targets are diffed against the source URL — the shared prefix
     is dimmed, the part that actually changed is highlighted.
   · Links are checked in batches (api.php?action=check_batch, curl_multi on
     the server) and results are cached per site for the browser session, so
     paging back and forth never re-checks what's already known.
   · Large pages render in windows of rows; more are added as you scroll.
   · Every database write is previewed in a confirm dialog and recorded in
     the session change log.
   ═══════════════════════════════════════════════════════════ */

const API = 'api.php';
const CHECK_BATCH = 8;            // URLs per check_batch request (checked in parallel server-side)
const CHECK_PARALLEL = 2;         // check_batch requests in flight at once
const ROW_WINDOW = 300;           // link rows rendered per chunk
const CHECK_TTL = 30 * 60 * 1000; // cached check results stay valid for 30 minutes

/* ── State ─────────────────────────────────────────────────── */
const state = {
    links: [],            // flat array from API
    linkIndex: new Map(), // linkKey → link
    groups: [],           // [{ postId, title, type, links[] }] — array, so sort order sticks
    view: [],             // filtered + sorted groups from the last render
    checked: {},          // { url: { status_code, is_redirect, redirect_url, t } }
    filter: 'all',        // all | ok | redirect | error | pending | duplicate
    linkType: 'all',      // all | internal | external
    search: '',
    searchScope: 'all',   // all | url | anchor | title
    searchTerms: [],      // lowercased, space split
    sort: 'id-asc',
    selected: new Set(),  // linkKey(link)
    collapsed: new Set(), // collapsed post IDs
    rowLimit: ROW_WINDOW,
    isLoading: false,
    isChecking: false,
    cancelCheck: false,
    checkAgain: false,    // a page loaded mid-check — run auto-check once it ends
    checkProgress: 0,
    checkTotal: 0,
    page: 1,
    totalPages: 1,
    totalPosts: 0,
    postCount: 0,         // posts on the current page that actually have links
    siteUrl: '',
    dbKey: '',
    dbLabel: '',
    postTypes: [],
    availablePostTypes: [],
    draftPostTypes: new Set(),
    activity: [],
};

const POST_TYPE_LABELS = {
    post: 'Blog Posts',
    page: 'Pages',
    whitepaper: 'Whitepapers',
    'case-studies': 'Case Studies',
    jobs: 'Jobs',
    job: 'Jobs (draft)',
    events: 'Events',
    event: 'Events (draft)',
    faq: 'FAQ Entries',
    alternatives: 'Alternatives',
};
const DEFAULT_POST_TYPES = ['post', 'page', 'whitepaper', 'case-studies'];

const LS = {
    postTypes: 'linkChecker.postTypes',
    perPage: 'linkChecker.perPage',
    autoCheck: 'linkChecker.autoCheck',
    density: 'linkChecker.density',
    sort: 'linkChecker.sort',
    scope: 'linkChecker.searchScope',
    theme: 'linkChecker.theme',
};
const SS = {
    checked: 'linkChecker.checked.',  // + db key
    activity: 'linkChecker.activity',
};

function lsGet(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
    } catch { return fallback; }
}
function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode — non-fatal */ }
}
function ssGetJson(key, fallback) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function ssSetJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode — non-fatal */ }
}

function postTypeLabel(type) {
    return POST_TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown');
}
function postTypeBadgeClass(type) {
    const known = ['post', 'page', 'whitepaper', 'case-studies', 'jobs', 'job', 'events', 'event', 'faq', 'alternatives'];
    return known.includes(type) ? `type-${type}` : 'type-other';
}

/* ── DOM refs ──────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const $tbody = $('tbody');
const $tableWrap = $('table-wrap');
const $bulkBar = $('bulk-bar');
const $bulkCount = $('bulk-count');
const $bulkNewUrl = $('bulk-new-url');
const $scanbar = document.querySelector('.scanbar');
const $scanMeta = $('scan-meta');
const $progressFill = $('progress-fill');
const $progressText = $('progress-text');
const $pagination = $('pagination');
const $selectAll = $('select-all');
const $toast = $('toast');
const $searchBox = $('searchbox');
const $search = $('inp-search');
const $searchScope = $('inp-search-scope');
const $searchCount = $('search-count');
const $filterNote = $('filter-note');
const $footerInfo = $('footer-info');
const $pageTotal = $('page-total');
const $inpPage = $('inp-page');
const $inpPerPage = $('inp-perpage');
const $menu = $('view-menu');

const $modal = $('edit-modal');
const $modalOldUrl = $('modal-old-url');
const $modalNewUrl = $('modal-new-url');
const $modalPostId = $('modal-post-id');
const $modalRemoveLink = $('modal-remove-link');
const $modalHint = $('modal-hint');
const $modalMeta = $('modal-meta');
const $modalAnchor = $('modal-anchor');
const $modalSub = $('modal-sub');
const $modalUseRedirect = $('btn-modal-use-redirect');
const $modalOpenOld = $('btn-modal-open-old');
const $helpModal = $('help-modal');
const $confirm = $('confirm-modal');

const $ptSelect = $('pt-select');
const $ptTrigger = $('pt-trigger');
const $ptTriggerLabel = $('pt-trigger-label');
const $ptOptions = $('pt-options');

/* ── Small helpers ─────────────────────────────────────────── */
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Attribute-safe: & must be encoded too, or URLs with query strings get
// mangled when the browser decodes the attribute value.
function escAttr(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n) { return Number(n || 0).toLocaleString(); }
function plural(n, word) { return `${fmt(n)} ${word}${n === 1 ? '' : 's'}`; }
function pct(n, total) { return total > 0 ? (n / total) * 100 : 0; }
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}
function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }
function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* Escape + wrap every search-term hit in <mark>. */
function hl(text, terms) {
    const s = String(text ?? '');
    if (!terms || !terms.length) return esc(s);
    const ls = s.toLowerCase();
    let out = '', pos = 0;
    while (pos < s.length) {
        let at = -1, len = 0;
        for (const t of terms) {
            if (!t) continue;
            const i = ls.indexOf(t, pos);
            if (i === -1) continue;
            if (at === -1 || i < at || (i === at && t.length > len)) { at = i; len = t.length; }
        }
        if (at === -1) break;
        out += esc(s.slice(pos, at)) + '<mark>' + esc(s.slice(at, at + len)) + '</mark>';
        pos = at + len;
    }
    return out + esc(s.slice(pos));
}

async function postJson(action, body) {
    const res = await fetch(`${API}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

/* ── Icons ─────────────────────────────────────────────────── */
const ICON = {
    refresh: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    pencil: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    chevron: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    wp: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    sun: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    link: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    search: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    alert: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

/* ── Toast ─────────────────────────────────────────────────── */
const TOAST_ICON = { success: '✓', error: '!', info: 'i' };

function showToast(msg, type = 'info', ms = 3600) {
    while ($toast.children.length >= 4) $toast.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast-item toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icon">${TOAST_ICON[type] || 'i'}</span><span class="toast-msg"></span>
        <button class="toast-close" aria-label="Dismiss">×</button>`;
    el.querySelector('.toast-msg').textContent = msg;
    const dismiss = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.toast-close').addEventListener('click', dismiss);
    $toast.appendChild(el);
    setTimeout(dismiss, type === 'error' ? Math.max(ms, 6000) : ms);
}

/* ── Clipboard (with a fallback for non-secure origins) ────── */
async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the legacy path */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════
   URL presentation — the core of this tool's readability
   ═══════════════════════════════════════════════════════════ */

/* scheme://host + everything after it, so the host can be dimmed and the
   path (the bit that actually differs between links) can be emphasised. */
function splitUrl(url) {
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(String(url || ''));
    if (!m) return { scheme: '', host: '', rest: String(url || '') };
    return { scheme: m[1], host: m[2], rest: m[3] };
}

/* Full URL, never truncated, with search hits highlighted. */
function urlHtml(url, terms) {
    const p = splitUrl(url);
    return `<span class="u-scheme">${hl(p.scheme, terms)}</span>` +
        `<span class="u-host">${hl(p.host, terms)}</span>` +
        `<span class="u-path">${hl(p.rest, terms)}</span>`;
}

/* Post content is arbitrary HTML from the DB, so an href could be
   javascript:/data: — only http(s) and root-relative hrefs get turned into a
   clickable link. Anything else is still shown in full, just not clickable. */
function isSafeHref(url) {
    return /^(https?:\/\/|\/)/i.test(String(url || '').trim());
}

/* Renders the URL as an <a> when it's safe to click, a <span> otherwise. */
function urlAnchor(url, terms, cls, extraTitle = '') {
    const inner = urlHtml(url, terms);
    const title = escAttr((extraTitle ? extraTitle + ' — ' : '') + url);
    return isSafeHref(url)
        ? `<a class="${cls}" href="${escAttr(url)}" target="_blank" rel="noopener" title="${title}">${inner}</a>`
        : `<span class="${cls}" title="${title} (not a clickable scheme)">${inner}</span>`;
}

/* Strip every raw whitespace character — URLs can't contain any, and a URL
   copied out of a wrapped line often arrives with newlines baked in. */
function normalizeUrl(v) {
    return String(v || '').replace(/\s+/g, '');
}

/* Where does the redirect target start to differ from the source URL?
   Backed off to the previous separator so the diff starts on a token
   boundary instead of mid-word. */
function diffStart(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i++;
    if (i >= b.length) return 0;           // target is a prefix of the source — show it all
    if (i < 8) return 0;                   // only the scheme matched: not worth dimming
    const cut = b.slice(0, i);
    const back = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('?'), cut.lastIndexOf('&'), cut.lastIndexOf('='));
    return back > 8 ? back + 1 : i;
}

/* Redirect target: shared prefix dim, changed part highlighted. */
function redirectHtml(fromUrl, toUrl) {
    const to = String(toUrl || '');
    const n = diffStart(String(fromUrl || ''), to);
    if (!n) return `<span class="u-diff">${esc(to)}</span>`;
    return `<span class="u-same">${esc(to.slice(0, n))}</span><span class="u-diff">${esc(to.slice(n))}</span>`;
}

/* A one-word summary of what the redirect actually changes. */
function redirectNote(fromUrl, toUrl) {
    const from = String(fromUrl || ''), to = String(toUrl || '');
    if (!from || !to) return '';
    if (from.replace(/\/+$/, '') === to.replace(/\/+$/, '')) {
        return to.endsWith('/') ? 'adds slash' : 'drops slash';
    }
    if (from.replace(/^http:/i, 'https:') === to) return 'to https';
    const a = splitUrl(from).host.replace(/^www\./i, '').toLowerCase();
    const b = splitUrl(to).host.replace(/^www\./i, '').toLowerCase();
    if (a && b && a !== b) return 'new host';
    if (splitUrl(from).host !== splitUrl(to).host) return 'www change';
    return '';
}

/* ═══════════════════════════════════════════════════════════
   Data loading
   ═══════════════════════════════════════════════════════════ */
async function loadLinks() {
    if (state.isLoading) return;
    state.isLoading = true;
    setTableLoading();

    const page = Math.max(1, parseInt($inpPage.value, 10) || 1);
    const perPage = Math.max(1, parseInt($inpPerPage.value, 10) || 50);
    $inpPage.value = page;
    let loaded = false;

    try {
        const types = encodeURIComponent(state.postTypes.join(','));
        const res = await fetch(`${API}?action=get_links&page=${page}&perPage=${perPage}&types=${types}`);
        const data = await res.json();
        if (data.status !== 'success') {
            showToast('API error: ' + data.message, 'error');
            setTableEmpty('Could not load posts.', data.message || '');
            return;
        }

        state.totalPages = Math.max(1, data.total_pages || 1);
        state.totalPosts = data.total_posts || 0;

        // Requested page is past the end (e.g. after shrinking Per Page) —
        // snap back to the last real page instead of showing an empty table.
        if (data.total_pages > 0 && page > data.total_pages) {
            $inpPage.value = data.total_pages;
            state.isLoading = false;
            return loadLinks();
        }

        state.page = data.page || page;
        state.links = data.links || [];
        state.selected.clear();
        state.collapsed.clear();
        state.rowLimit = ROW_WINDOW;

        state.siteUrl = data.site_url || '';
        const $siteLabel = $('site-url-label');
        $siteLabel.textContent = state.siteUrl.replace(/^https?:\/\//, '');
        $siteLabel.href = state.siteUrl || '#';

        buildGroups();
        updateStats();
        renderTable();
        renderPagination();
        updateScanMeta();
        loaded = true;
    } catch (e) {
        showToast('Failed to load: ' + e.message, 'error');
        setTableEmpty('Failed to reach the API.', e.message);
    } finally {
        state.isLoading = false;
    }

    if (loaded && $('chk-autocheck').checked) {
        if (state.isChecking) state.checkAgain = true;
        else checkAllLinks({ recheckIfDone: false });
    }
}

function updateScanMeta() {
    $scanMeta.innerHTML = `Page <strong>${fmt(state.page)}</strong> of <strong>${fmt(state.totalPages)}</strong>
        · <strong>${fmt(state.totalPosts)}</strong> published`;
}

/* ── Database switcher ─────────────────────────────────────────
 * Lets this tool point at a different site's database. Persisted in its
 * own "pc_db" cookie, scoped to this folder - kept separate from the "db"
 * cookie other tools under healthray-sql/ share, so switching here never
 * affects them (see api.php's "databases" action / conn.php). */
async function loadDatabaseSwitcher() {
    try {
        const res = await fetch(`${API}?action=databases`);
        const data = await res.json();
        if (data.status !== 'success') return;
        const sel = $('site-select');
        sel.innerHTML = (data.databases || []).map(d =>
            `<option value="${escAttr(d.key)}"${d.key === data.current ? ' selected' : ''}>${esc(d.label)}</option>`
        ).join('');
        state.dbKey = data.current || '';
        state.dbLabel = (data.databases || []).find(d => d.key === data.current)?.label || state.dbKey;
    } catch (e) {
        console.error('Failed to load database list', e);
    }
}

function bindDatabaseSwitcher() {
    $('site-select').addEventListener('change', e => {
        const key = e.target.value;
        document.cookie = `pc_db=${encodeURIComponent(key)}; path=/salvadore/healthray-sql/post-content/; max-age=${60 * 60 * 24 * 365}`;
        location.reload();
    });
}

/* A URL can exist both as a post_content <a> and inside an FAQ answer field
   on the same post, so post_id + url alone can't identify an occurrence. */
function linkKey(link) {
    return `${link.post_id}||${link.url}||${link.source || 'content'}||${link.meta_key || ''}`;
}
function findLinkByKey(key) {
    return state.linkIndex.get(key);
}

/* ── Post type picker ──────────────────────────────────────── */
async function loadPostTypes() {
    try {
        const res = await fetch(`${API}?action=post_types`);
        const data = await res.json();
        if (data.status !== 'success') { showToast('Could not load post types: ' + data.message, 'error'); return; }

        state.availablePostTypes = data.post_types || [];
        const availableKeys = state.availablePostTypes.map(t => t.post_type);

        let saved = [];
        try { saved = JSON.parse(lsGet(LS.postTypes, '[]')) || []; } catch { saved = []; }
        const savedValid = saved.filter(t => availableKeys.includes(t));

        state.postTypes = savedValid.length ? savedValid
            : DEFAULT_POST_TYPES.filter(t => availableKeys.includes(t));
        if (!state.postTypes.length && availableKeys.length) state.postTypes = [availableKeys[0]];

        state.draftPostTypes = new Set(state.postTypes);
        renderPostTypeOptions();
        updatePostTypeTriggerLabel();
    } catch (e) {
        showToast('Failed to load post types: ' + e.message, 'error');
    }
}

function renderPostTypeOptions() {
    if (!state.availablePostTypes.length) {
        $ptOptions.innerHTML = `<div class="pt-empty">No content types found.</div>`;
        return;
    }
    $ptOptions.innerHTML = state.availablePostTypes.map(t => `
        <label class="pt-option">
            <input type="checkbox" class="pt-checkbox" value="${escAttr(t.post_type)}" ${state.draftPostTypes.has(t.post_type) ? 'checked' : ''}>
            <span class="pt-option-label" title="${escAttr(t.post_type)}">${esc(postTypeLabel(t.post_type))}</span>
            <span class="pt-option-count">${fmt(t.count)}</span>
        </label>
    `).join('');
}

function updatePostTypeTriggerLabel() {
    const n = state.postTypes.length;
    if (n === 0) $ptTriggerLabel.textContent = 'Post types';
    else if (n <= 2) $ptTriggerLabel.textContent = state.postTypes.map(postTypeLabel).join(', ');
    else $ptTriggerLabel.textContent = `${n} types selected`;
    $ptTrigger.title = n ? 'Scanning: ' + state.postTypes.map(postTypeLabel).join(', ') : 'Choose content types to scan';
}

function togglePostTypePanel() {
    const opening = !$ptSelect.classList.contains('open');
    if (opening) {
        state.draftPostTypes = new Set(state.postTypes);
        renderPostTypeOptions();
    }
    $ptSelect.classList.toggle('open', opening);
    $ptTrigger.setAttribute('aria-expanded', String(opening));
}
function closePostTypePanel() {
    $ptSelect.classList.remove('open');
    $ptTrigger.setAttribute('aria-expanded', 'false');
}

function setDraftPostTypes(all) {
    state.draftPostTypes = all ? new Set(state.availablePostTypes.map(t => t.post_type)) : new Set();
    renderPostTypeOptions();
}

function applyPostTypes() {
    if (!state.draftPostTypes.size) { showToast('Select at least one content type', 'error'); return; }
    state.postTypes = [...state.draftPostTypes];
    lsSet(LS.postTypes, JSON.stringify(state.postTypes));
    updatePostTypeTriggerLabel();
    closePostTypePanel();
    $inpPage.value = 1;
    loadLinks();
}

/* ── Grouping ──────────────────────────────────────────────── */
function buildGroups() {
    const map = new Map();
    state.linkIndex = new Map();
    for (const link of state.links) {
        state.linkIndex.set(linkKey(link), link);
        const id = String(link.post_id);
        if (!map.has(id)) map.set(id, { postId: id, title: link.post_title, type: link.post_type, links: [] });
        map.get(id).links.push(link);
    }
    state.groups = [...map.values()];
    state.postCount = state.groups.length;
}

/* ── Search / filtering ────────────────────────────────────── */
function haystack(link) {
    switch (state.searchScope) {
        case 'url': return link.url || '';
        case 'anchor': return link.anchor_text || '';
        case 'title': return link.post_title || '';
        default: return `${link.url || ''} ${link.anchor_text || ''} ${link.post_title || ''}`;
    }
}
function matchesSearch(link) {
    if (!state.searchTerms.length) return true;
    const hay = haystack(link).toLowerCase();
    return state.searchTerms.every(t => hay.includes(t));
}
function matchesType(link) {
    if (state.linkType === 'internal') return !!link.is_internal;
    if (state.linkType === 'external') return !link.is_internal;
    return true;
}
function matchesStatus(link) {
    const c = state.checked[link.url];
    if (state.filter === 'duplicate') return link.occurrence_count > 1;
    if (state.filter === 'all') return true;
    if (!c) return state.filter === 'pending';
    if (state.filter === 'ok') return c.status_code >= 200 && c.status_code < 300;
    if (state.filter === 'redirect') return c.status_code >= 300 && c.status_code < 400;
    if (state.filter === 'error') return c.status_code === 0 || c.status_code >= 400;
    return true;
}

/* Links matching the type tab + search only (ignores the status filter) —
   used to scope "Check links" to what the user is actually looking at. */
function typeFilteredLinks() {
    return state.links.filter(l => matchesType(l) && matchesSearch(l));
}

function groupStats(links) {
    let redirects = 0, errors = 0, pending = 0;
    for (const l of links) {
        const c = state.checked[l.url];
        if (!c) { pending++; continue; }
        if (c.is_redirect && c.redirect_url) redirects++;
        else if (c.status_code === 0 || c.status_code >= 400) errors++;
    }
    return { redirects, errors, pending };
}

/* Filtered groups, in the requested sort order (array — object key order
   would silently re-sort numeric post IDs). */
function filteredGroups() {
    const out = [];
    for (const g of state.groups) {
        const links = g.links.filter(l => matchesType(l) && matchesSearch(l) && matchesStatus(l));
        if (links.length) out.push({ ...g, links });
    }

    const byIssues = g => {
        const s = groupStats(g.links);
        return s.errors * 10 + s.redirects;
    };
    switch (state.sort) {
        case 'id-desc': out.sort((a, b) => Number(b.postId) - Number(a.postId)); break;
        case 'title-asc': out.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })); break;
        case 'issues': out.sort((a, b) => byIssues(b) - byIssues(a) || Number(a.postId) - Number(b.postId)); break;
        case 'links-desc': out.sort((a, b) => b.links.length - a.links.length || Number(a.postId) - Number(b.postId)); break;
        default: out.sort((a, b) => Number(a.postId) - Number(b.postId));
    }
    return out;
}
/* Every link that passes the filters — including rows not yet rendered by
   the row window, so "select all" / export cover the whole view. */
function visibleLinks() {
    return state.view.flatMap(g => g.links);
}

/* ═══════════════════════════════════════════════════════════
   Checking
   ═══════════════════════════════════════════════════════════ */
function checkedCacheKey() { return SS.checked + (state.dbKey || 'default'); }

function loadCheckedCache() {
    const raw = ssGetJson(checkedCacheKey(), {});
    const now = Date.now();
    state.checked = {};
    for (const [url, r] of Object.entries(raw)) {
        if (r && now - (r.t || 0) < CHECK_TTL) state.checked[url] = r;
    }
}

let cacheTimer = null;
function saveCheckedCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => ssSetJson(checkedCacheKey(), state.checked), 400);
}

function setChecked(url, result) {
    state.checked[url] = { ...result, t: Date.now() };
    saveCheckedCache();
}

const FAILED_CHECK = { status_code: 0, is_redirect: false, redirect_url: null };

/* Check a handful of URLs in one request — the server runs them in
   parallel with curl_multi. */
async function checkUrls(urls) {
    try {
        const data = await postJson('check_batch', { urls });
        if (data.status !== 'success') throw new Error(data.message || 'check failed');
        for (const u of urls) setChecked(u, data.results?.[u] || FAILED_CHECK);
    } catch {
        for (const u of urls) setChecked(u, FAILED_CHECK);
    }
}

async function checkAllLinks({ recheckIfDone = true } = {}) {
    if (state.isChecking || state.isLoading) return;
    const inView = typeFilteredLinks();

    // Check each distinct URL once — the same URL often appears on many posts.
    let urls = [...new Set(inView.filter(l => !state.checked[l.url]).map(l => l.url))];
    if (!urls.length) {
        if (!recheckIfDone) return;
        // Everything in view is already checked — the button reads
        // "Re-check", so re-check it all.
        urls = [...new Set(inView.map(l => l.url))];
    }
    if (!urls.length) { showToast('No links in this view to check', 'info'); return; }

    state.isChecking = true;
    state.cancelCheck = false;
    state.checkTotal = urls.length;
    state.checkProgress = 0;
    $scanbar.classList.add('is-checking');
    updateProgress();
    setCheckAllBusy(true);

    // Repainting the whole table after every batch gets expensive on big
    // pages, so live feedback is throttled — the final render happens once
    // the run finishes either way.
    const batches = chunk(urls, CHECK_BATCH);
    let next = 0, lastPaint = 0;
    const worker = async () => {
        while (next < batches.length && !state.cancelCheck) {
            const batch = batches[next++];
            await checkUrls(batch);
            state.checkProgress += batch.length;
            updateProgress();
            if (Date.now() - lastPaint > 500) {
                updateStats();
                renderTable();
                lastPaint = Date.now();
            }
        }
    };
    await Promise.all(Array.from({ length: CHECK_PARALLEL }, worker));

    const cancelled = state.cancelCheck;
    state.isChecking = false;
    state.cancelCheck = false;
    $scanbar.classList.remove('is-checking');
    setCheckAllBusy(false);
    updateStats();
    renderTable();

    if (cancelled) {
        showToast(`Stopped after ${plural(state.checkProgress, 'URL')}`, 'info');
    } else {
        const broken = urls.filter(u => { const c = state.checked[u]; return c && (c.status_code === 0 || c.status_code >= 400); }).length;
        const redirects = urls.filter(u => state.checked[u]?.is_redirect).length;
        const bits = [];
        if (broken) bits.push(plural(broken, 'broken link'));
        if (redirects) bits.push(plural(redirects, 'redirect'));
        showToast(`Checked ${plural(urls.length, 'URL')}${bits.length ? ' — ' + bits.join(', ') : ' — all OK'}`,
            broken ? 'error' : 'success');
    }

    if (state.checkAgain) {
        state.checkAgain = false;
        checkAllLinks({ recheckIfDone: false });
    }
}

function setCheckAllBusy(busy) {
    const btn = $('btn-check-all');
    btn.disabled = busy;
    $('btn-cancel-check').disabled = false;
    if (busy) $('check-all-label').textContent = 'Checking…';
    else updateCheckAllLabel();
}

async function checkRowLink(url, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin spin-dark"></span>';
    await checkUrls([url]);
    updateStats();
    renderTable();
}

async function checkGroup(postId, btn) {
    const g = state.view.find(x => x.postId === String(postId));
    if (!g) return;
    const urls = [...new Set(g.links.filter(l => !state.checked[l.url]).map(l => l.url))];
    if (!urls.length) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin spin-dark"></span>';
    await Promise.all(chunk(urls, CHECK_BATCH).map(checkUrls));
    updateStats();
    renderTable();
}

function updateProgress() {
    const p = Math.round(pct(state.checkProgress, state.checkTotal));
    $progressFill.style.width = p + '%';
    $progressText.textContent = `Checking ${fmt(state.checkProgress)} of ${fmt(state.checkTotal)} URLs · ${p}%`;
}

function forgetCheckResults() {
    if (state.isChecking) { showToast('Stop the running check first', 'error'); return; }
    state.checked = {};
    ssSetJson(checkedCacheKey(), {});
    updateStats();
    renderTable();
    showToast('Check results cleared', 'info', 2400);
}

/* ═══════════════════════════════════════════════════════════
   Stats & counters
   ═══════════════════════════════════════════════════════════ */
function updateStats() {
    let ok = 0, rd = 0, err = 0, pend = 0, internal = 0, external = 0, dupe = 0;
    for (const link of state.links) {
        const c = state.checked[link.url];
        if (!c) pend++;
        else if (c.status_code >= 200 && c.status_code < 300) ok++;
        else if (c.status_code >= 300 && c.status_code < 400) rd++;
        else err++;
        link.is_internal ? internal++ : external++;
        if (link.occurrence_count > 1) dupe++;
    }
    const total = state.links.length;
    const checked = ok + rd + err;

    $('stat-total').textContent = fmt(total);
    $('stat-total-sub').textContent = `in ${plural(state.postCount, 'post')}`;
    $('stat-ok').textContent = fmt(ok);
    $('stat-rd').textContent = fmt(rd);
    $('stat-err').textContent = fmt(err);
    $('stat-pend').textContent = fmt(pend);
    $('stat-dup').textContent = fmt(dupe);
    $('meter-ok').style.width = pct(ok, total) + '%';
    $('meter-rd').style.width = pct(rd, total) + '%';
    $('meter-err').style.width = pct(err, total) + '%';
    $('meter-pend').style.width = pct(pend, total) + '%';
    $('meter-dup').style.width = pct(dupe, total) + '%';

    // Health = share of checked links that resolve cleanly (2xx).
    const $card = $('health-card');
    const score = checked ? Math.round(pct(ok, checked)) : null;
    $('health-score').textContent = score === null ? '—' : score + '%';
    $card.classList.toggle('is-good', score !== null && score >= 90);
    $card.classList.toggle('is-fair', score !== null && score >= 70 && score < 90);
    $card.classList.toggle('is-poor', score !== null && score < 70);
    $('hb-ok').style.width = pct(ok, total) + '%';
    $('hb-rd').style.width = pct(rd, total) + '%';
    $('hb-err').style.width = pct(err, total) + '%';
    $('health-foot').innerHTML = !total ? 'No links on this page'
        : checked ? `<strong>${fmt(checked)}</strong> of <strong>${fmt(total)}</strong> checked${err ? ` · <strong>${fmt(err)}</strong> broken` : ''}`
            : 'Run a check to score this page';

    const typeCounts = { all: total, internal, external };
    document.querySelectorAll('#type-tabs .seg-btn').forEach(btn => {
        const fc = btn.querySelector('.fc');
        if (fc) fc.textContent = fmt(typeCounts[btn.dataset.type] ?? 0);
    });

    updateCheckAllLabel();
}

function updateCheckAllLabel() {
    if (state.isChecking) return;
    const pending = new Set(typeFilteredLinks().filter(l => !state.checked[l.url]).map(l => l.url)).size;
    const typeName = state.linkType === 'internal' ? 'internal' : state.linkType === 'external' ? 'external' : 'links';
    const el = $('check-all-label');
    if (el) el.textContent = pending ? `Check ${typeName} (${fmt(pending)})` : `Re-check ${typeName}`;
}

function updateCounters(shownLinks, shownGroups) {
    const total = state.links.length;
    const filtered = state.filter !== 'all' || state.linkType !== 'all' || state.searchTerms.length > 0;

    $filterNote.innerHTML = filtered
        ? `Showing <strong>${fmt(shownLinks)}</strong> of <strong>${fmt(total)}</strong>
           <button class="link-btn" data-reset-filters>Reset</button>`
        : '';

    $footerInfo.innerHTML = `<strong>${fmt(shownGroups)}</strong> post${shownGroups === 1 ? '' : 's'} ·
        <strong>${fmt(shownLinks)}</strong> link${shownLinks === 1 ? '' : 's'} in view`;

    $searchCount.textContent = state.searchTerms.length ? `${fmt(shownLinks)} match${shownLinks === 1 ? '' : 'es'}` : '';
    $searchBox.classList.toggle('has-value', !!state.search);
}

/* ═══════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════ */
function renderTable() {
    const scrollTop = $tableWrap.scrollTop;
    const groups = filteredGroups();
    state.view = groups;
    const shownLinks = groups.reduce((n, g) => n + g.links.length, 0);

    if (!groups.length) {
        $tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml()}</td></tr>`;
        observeMoreRow();
        updateCounters(0, 0);
        updateBulkBar();
        syncSelectAll();
        updateToggleAllLabel();
        writeHash();
        return;
    }

    const terms = state.searchTerms;
    const parts = [];
    let rows = 0, truncated = false;

    for (const g of groups) {
        // Only ever stop between groups, so a post is never half-rendered.
        if (rows >= state.rowLimit) { truncated = true; break; }

        const collapsed = state.collapsed.has(g.postId);
        const { redirects, errors, pending } = groupStats(g.links);
        const allSel = g.links.every(l => state.selected.has(linkKey(l)));

        const metaBits = [`<span>${plural(g.links.length, 'link')}</span>`];
        if (redirects) metaBits.push(`<span class="gm-pill gm-rd">${plural(redirects, 'redirect')}</span>`);
        if (errors) metaBits.push(`<span class="gm-pill gm-err">${fmt(errors)} broken</span>`);

        const viewUrl = state.siteUrl ? `${state.siteUrl}/?p=${encodeURIComponent(g.postId)}` : '';
        const editUrl = state.siteUrl ? `${state.siteUrl}/wp-admin/post.php?post=${encodeURIComponent(g.postId)}&action=edit` : '';

        parts.push(`<tr class="group-row${collapsed ? ' is-collapsed' : ''}" data-post-id="${escAttr(g.postId)}">
          <td colspan="5">
            <div class="group-row-inner">
              <button class="group-toggle" data-act="toggle" data-post-id="${escAttr(g.postId)}"
                      title="${collapsed ? 'Expand' : 'Collapse'} this post" aria-label="Toggle post group" aria-expanded="${!collapsed}">${ICON.chevron}</button>
              <span class="type-badge ${postTypeBadgeClass(g.type)}">${esc(postTypeLabel(g.type))}</span>
              ${viewUrl
                ? `<a class="group-title" href="${escAttr(viewUrl)}" target="_blank" rel="noopener" title="${escAttr(g.title)} — open on the site">${hl(g.title, terms)}</a>`
                : `<span class="group-title" title="${escAttr(g.title)}">${hl(g.title, terms)}</span>`}
              <span class="group-post-id">#${esc(g.postId)}</span>
              <span class="group-meta">${metaBits.join('')}</span>
              <span class="group-actions">
                ${pending ? `<button class="btn btn-ghost btn-xs" data-act="checkgroup" data-post-id="${escAttr(g.postId)}"
                        title="Check the ${fmt(pending)} unchecked link(s) in this post">Check ${fmt(pending)}</button>` : ''}
                ${redirects ? `<button class="btn btn-warning btn-xs" data-act="fixgroup" data-post-id="${escAttr(g.postId)}"
                        title="Replace every redirecting URL in this post with its target">Fix ${fmt(redirects)}</button>` : ''}
                ${editUrl ? `<a class="icon-btn" href="${escAttr(editUrl)}" target="_blank" rel="noopener" title="Open in the WordPress editor">${ICON.wp}</a>` : ''}
                <label class="group-select-all" title="Select every link shown for this post">
                  <input type="checkbox" class="group-check" data-post-id="${escAttr(g.postId)}" ${allSel ? 'checked' : ''}> <span>All</span>
                </label>
              </span>
            </div>
          </td>
        </tr>`);

        if (collapsed) continue;

        for (const link of g.links) {
            const key = linkKey(link);
            const c = state.checked[link.url];
            const sel = state.selected.has(key);
            parts.push(`<tr class="link-row${sel ? ' selected' : ''}${rowStateClass(c)}" data-key="${escAttr(key)}">${linkRowInner(link, c, key, sel)}</tr>`);
            rows++;
        }
    }

    if (truncated) {
        const remaining = shownLinks - rows;
        parts.push(`<tr class="more-row"><td colspan="5">
            <button class="btn btn-ghost btn-sm" data-act="more">Show ${fmt(Math.min(remaining, ROW_WINDOW))} more</button>
            <span>&nbsp;· ${fmt(remaining)} links not shown yet</span></td></tr>`);
    }

    $tbody.innerHTML = parts.join('');
    $tableWrap.scrollTop = scrollTop;
    observeMoreRow();

    updateCounters(shownLinks, groups.length);
    updateBulkBar();
    syncSelectAll();
    updateToggleAllLabel();
    writeHash();
}

/* Grow the row window automatically as the "Show more" row scrolls into view. */
const moreObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) showMoreRows();
    }, { root: window.matchMedia('(max-width: 768px)').matches ? null : $tableWrap, rootMargin: '400px 0px' })
    : null;

function observeMoreRow() {
    if (!moreObserver) return;
    moreObserver.disconnect();
    const row = $tbody.querySelector('.more-row');
    if (row) moreObserver.observe(row);
}
function showMoreRows() {
    state.rowLimit += ROW_WINDOW;
    renderTable();
}
function resetWindow() {
    state.rowLimit = ROW_WINDOW;
    $tableWrap.scrollTop = 0;
}

function rowStateClass(c) {
    if (!c) return '';
    if (c.status_code >= 200 && c.status_code < 300) return ' row-ok';
    if (c.status_code >= 300 && c.status_code < 400) return ' row-redirect';
    return ' row-error';
}

function emptyStateHtml() {
    if (!state.links.length) {
        return `<div class="empty-state"><div class="es-icon">${ICON.link}</div>
            <p>No links found on this page of posts</p>
            <div class="sub">Try another page, a larger page size, or more content types.</div></div>`;
    }
    const msg = state.filter === 'error' ? 'No broken links here — nice.'
        : state.filter === 'redirect' ? 'No redirects in this view.'
            : 'No links match the current filters';
    return `<div class="empty-state"><div class="es-icon">${ICON.search}</div>
        <p>${msg}</p>
        <div class="sub">${state.searchTerms.length ? `Search: “${esc(state.search)}”` : 'Adjust the status or link-type filter.'}</div>
        <button class="btn btn-ghost btn-sm" data-reset-filters>Reset filters</button></div>`;
}

function linkRowInner(link, c, key, sel) {
    const terms = state.searchTerms;

    const tags = [];
    if (link.source === 'faq') {
        tags.push(`<span class="sbadge s-faq" title="Inside an FAQ answer field (${escAttr(link.meta_key || '')}), not the post body">FAQ</span>`);
    }
    if (link.occurrence_count > 1) {
        tags.push(`<span class="sbadge s-chk" title="This exact URL is linked ${link.occurrence_count} times in this post — editing or unlinking updates all of them">×${link.occurrence_count}</span>`);
    }
    if (state.linkType === 'all' && !link.is_internal) {
        tags.push(`<span class="sbadge s-ext" title="Points to another domain">EXT</span>`);
    }

    let redirLine = '';
    if (c?.is_redirect && c.redirect_url) {
        const note = redirectNote(link.url, c.redirect_url);
        const diff = redirectHtml(link.url, c.redirect_url);
        const target = isSafeHref(c.redirect_url)
            ? `<a class="redir-url" href="${escAttr(c.redirect_url)}" target="_blank" rel="noopener"
                  title="Redirect target — ${escAttr(c.redirect_url)}">${diff}</a>`
            : `<span class="redir-url" title="Redirect target — ${escAttr(c.redirect_url)}">${diff}</span>`;
        redirLine = `<div class="redir-line">
            <span class="redir-arrow" title="Redirect target">→</span>
            <div class="redir-main">${target}<button
               class="icon-btn" data-act="copy" data-url="${escAttr(c.redirect_url)}" title="Copy the redirect target">${ICON.copy}</button>${note ? `<span class="redir-note">${esc(note)}</span>` : ''}</div>
        </div>`;
    }

    const anchor = (link.anchor_text || '').trim();

    return `
      <td class="cell-check"><input type="checkbox" class="row-check" data-key="${escAttr(key)}" ${sel ? 'checked' : ''} aria-label="Select link"></td>
      <td class="hide-mob"><div class="anchor-text${anchor && anchor !== '(no text)' ? '' : ' is-empty'}" title="${escAttr(anchor)}">${hl(anchor || '(no text)', terms)}</div></td>
      <td>
        <div class="url-cell">${urlAnchor(link.url, terms, 'url-link')}<button class="icon-btn" data-act="copy"
            data-url="${escAttr(link.url)}" title="Copy this URL">${ICON.copy}</button>${tags.length ? `<span class="url-tags">${tags.join('')}</span>` : ''}</div>
        ${redirLine}
      </td>
      <td>${statusBadge(c)}</td>
      <td>
        <div class="row-actions">
          ${c?.is_redirect && c.redirect_url
            ? `<button class="btn btn-warning btn-xs" data-act="fix" data-key="${escAttr(key)}" title="Replace this URL with its redirect target">Fix</button>`
            : ''}
          ${!c
            ? `<button class="btn btn-ghost btn-xs" data-act="check" data-url="${escAttr(link.url)}" title="Check this URL now">Check</button>`
            : `<button class="icon-btn" data-act="check" data-url="${escAttr(link.url)}" title="Re-check this URL (checked ${escAttr(timeAgo(c.t || Date.now()))})">${ICON.refresh}</button>`}
          <button class="icon-btn" data-act="edit" data-key="${escAttr(key)}" title="Edit or unlink this link">${ICON.pencil}</button>
        </div>
      </td>`;
}

function statusBadge(c) {
    if (!c) return `<span class="sbadge s-pend">Unchecked</span>`;
    const code = c.status_code;
    if (code === 0) return `<span class="sbadge s-4xx" title="No response — timeout, DNS failure or blocked request">Timeout</span>`;
    if (code >= 200 && code < 300) return `<span class="sbadge s-200" title="HTTP ${code} — reachable">${code} OK</span>`;
    if (code >= 300 && code < 400) return `<span class="sbadge s-3xx" title="HTTP ${code} — redirects to another URL">${code}</span>`;
    return `<span class="sbadge s-4xx" title="HTTP ${code} — broken or unavailable">${code}</span>`;
}

/* ── Collapse / expand ─────────────────────────────────────── */
function toggleGroup(postId) {
    state.collapsed.has(postId) ? state.collapsed.delete(postId) : state.collapsed.add(postId);
    renderTable();
}
function toggleAllGroups() {
    const anyOpen = state.view.some(g => !state.collapsed.has(g.postId));
    if (anyOpen) state.view.forEach(g => state.collapsed.add(g.postId));
    else state.view.forEach(g => state.collapsed.delete(g.postId));
    renderTable();
}
function updateToggleAllLabel() {
    const anyOpen = state.view.some(g => !state.collapsed.has(g.postId));
    $('btn-toggle-all').textContent = anyOpen ? 'Collapse all' : 'Expand all';
}

/* ═══════════════════════════════════════════════════════════
   Confirm dialog — every DB write is previewed here first
   ═══════════════════════════════════════════════════════════ */
let confirmResolve = null;

/* changes: [{ post, from, to }] — to === '' means "unlinked". */
function confirmDialog({ title, message = '', changes = [], okLabel = 'Confirm', tone = 'primary' }) {
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = message;

    const MAX = 60;
    const list = $('confirm-list');
    list.innerHTML = changes.slice(0, MAX).map(c => `<li>
        <div class="cl-post">${esc(c.post)}</div>
        <div class="cl-from">${esc(c.from)}</div>
        <div class="cl-to">${c.to ? esc(c.to) : '<em>link removed — anchor text kept</em>'}</div>
    </li>`).join('') + (changes.length > MAX ? `<li class="cl-more">…and ${fmt(changes.length - MAX)} more</li>` : '');
    list.hidden = !changes.length;

    $('confirm-db').textContent = `Writes to ${state.dbLabel || 'the database'}`;
    const ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.className = `btn btn-${tone}`;

    $confirm.classList.add('open');
    setTimeout(() => ok.focus(), 40);
    return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirm(result) {
    if (!confirmResolve) return;
    $confirm.classList.remove('open');
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve(result);
}

function postLabel(link) {
    return `#${link.post_id} · ${trunc(link.post_title || '', 70)}${link.source === 'faq' ? ` · FAQ (${link.meta_key})` : ''}`;
}

/* ═══════════════════════════════════════════════════════════
   Change log (session)
   ═══════════════════════════════════════════════════════════ */
function logActivity(entries) {
    if (!entries.length) return;
    const t = Date.now();
    state.activity.unshift(...entries.map(e => ({ ...e, t, db: state.dbLabel })));
    state.activity = state.activity.slice(0, 1000);
    ssSetJson(SS.activity, state.activity);
    renderActivityCount();
    if (document.body.classList.contains('drawer-open')) renderActivity();
}

function activityEntry(link, to) {
    return {
        action: to ? 'update' : 'unlink',
        postId: link.post_id,
        title: link.post_title || '',
        source: link.source === 'faq' ? `FAQ (${link.meta_key || ''})` : 'Post content',
        from: link.url,
        to: to || '',
    };
}

function renderActivityCount() {
    const n = state.activity.length;
    const el = $('activity-count');
    el.textContent = fmt(n);
    el.classList.toggle('has-items', n > 0);
}

function renderActivity() {
    const list = $('activity-list');
    if (!state.activity.length) {
        list.innerHTML = `<div class="act-empty">No changes yet this session.<br>Edits, fixes and unlinks will be listed here.</div>`;
        return;
    }
    list.innerHTML = state.activity.map(a => `<div class="act-item">
        <div class="act-head">
            <span class="sbadge no-dot ${a.action === 'unlink' ? 's-4xx' : 's-200'}">${a.action === 'unlink' ? 'Unlinked' : 'Updated'}</span>
            <span class="act-title" title="${escAttr(a.title)}">#${esc(a.postId)} · ${esc(a.title)}</span>
            <span class="act-time" title="${escAttr(new Date(a.t).toLocaleString())}">${esc(timeAgo(a.t))}</span>
        </div>
        <div class="act-urls">
            <div class="cl-from">${esc(a.from)}</div>
            <div class="cl-to">${a.to ? esc(a.to) : '<em>link removed — anchor text kept</em>'}</div>
        </div>
        <div class="act-db">${esc(a.source)} · ${esc(a.db || '')}</div>
    </div>`).join('');
}

function openDrawer() {
    renderActivity();
    document.body.classList.add('drawer-open');
    $('activity-drawer').setAttribute('aria-hidden', 'false');
    $('drawer-close').focus();
}
function closeDrawer() {
    document.body.classList.remove('drawer-open');
    $('activity-drawer').setAttribute('aria-hidden', 'true');
}

function exportActivityCsv() {
    if (!state.activity.length) { showToast('No changes to export', 'info'); return; }
    downloadCsv('link-changes', [
        ['Time', 'Site', 'Action', 'Post ID', 'Post Title', 'Source', 'Old URL', 'New URL'],
        ...state.activity.map(a => [new Date(a.t).toLocaleString(), a.db, a.action, a.postId, a.title, a.source, a.from, a.to]),
    ]);
}

/* ═══════════════════════════════════════════════════════════
   Writes — update / remove (API payloads unchanged)
   ═══════════════════════════════════════════════════════════ */
async function fixGroupRedirects(postId) {
    const group = state.groups.find(g => g.postId === String(postId));
    if (!group) return;

    const links = group.links.filter(l => state.checked[l.url]?.is_redirect && state.checked[l.url]?.redirect_url);
    if (!links.length) { showToast('No redirecting links in this post', 'error'); return; }

    const ok = await confirmDialog({
        title: `Fix ${plural(links.length, 'redirect')}`,
        message: `Each URL in “${group.title}” is replaced with the target it redirects to.`,
        changes: links.map(l => ({ post: postLabel(l), from: l.url, to: state.checked[l.url].redirect_url })),
        okLabel: `Fix ${plural(links.length, 'link')}`,
        tone: 'warning',
    });
    if (!ok) return;

    await runBulkUpdate(links.map(l => [l, state.checked[l.url].redirect_url]));
}

async function fixSingleRedirect(key, btn) {
    const link = findLinkByKey(key);
    if (!link) { showToast('Link not found — reload posts', 'error'); return; }
    const newUrl = state.checked[link.url]?.redirect_url;
    if (!newUrl) { showToast('No redirect target found — check the link first', 'error'); return; }

    const ok = await confirmDialog({
        title: 'Fix redirect',
        message: 'Replace this URL with the target it redirects to?',
        changes: [{ post: postLabel(link), from: link.url, to: newUrl }],
        okLabel: 'Replace URL',
        tone: 'warning',
    });
    if (!ok) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    await saveLinkUpdate(link, newUrl);
}

/* Write one URL change and sync state. Shared by Fix and the edit modal. */
async function saveLinkUpdate(link, newUrl) {
    const { post_id: postId, url: oldUrl, source = 'content', meta_key: metaKey = null } = link;
    try {
        const data = await postJson('update_link', { post_id: postId, old_url: oldUrl, new_url: newUrl, source, meta_key: metaKey });

        if (data.status === 'success') {
            logActivity([activityEntry(link, newUrl)]);
            updateLinkInState(postId, oldUrl, newUrl, source, metaKey);
            showToast('Link updated', 'success');
            if (!state.checked[newUrl] || state.checked[newUrl].is_redirect) await checkUrls([newUrl]);
            buildGroups();
            updateStats();
            renderTable();
            return true;
        }
        if (data.status === 'no_change') {
            showToast('URL not found in ' + (source === 'faq' ? 'the FAQ field' : 'the post content') + ' — reload posts', 'info');
        } else {
            showToast('Error: ' + data.message, 'error');
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
    }
    renderTable();
    return false;
}

/* pairs: [[link, newUrl], …] */
async function runBulkUpdate(pairs) {
    const updates = pairs.map(([l, to]) => ({
        post_id: l.post_id, old_url: l.url, new_url: to,
        source: l.source || 'content', meta_key: l.meta_key || null,
    }));
    try {
        const data = await postJson('bulk_update', { updates });
        if (data.status !== 'success') { showToast('Bulk update failed: ' + (data.message || ''), 'error'); return; }
        showToast(`Updated ${fmt(data.updated)} of ${plural(data.total, 'link')}`, data.updated ? 'success' : 'info');

        // The API returns exactly one result per update, in order.
        const done = pairs.filter((_, i) => data.results?.[i]?.status === 'updated');
        logActivity(done.map(([l, to]) => activityEntry(l, to)));
        for (const [l, to] of done) updateLinkInState(l.post_id, l.url, to, l.source || 'content', l.meta_key || null);

        const recheck = [...new Set(done.map(([, to]) => to))].filter(u => !state.checked[u] || state.checked[u].is_redirect);
        if (recheck.length) await Promise.all(chunk(recheck, CHECK_BATCH).map(checkUrls));

        state.selected.clear();
        buildGroups();
        updateStats();
        renderTable();
    } catch (e) {
        showToast('Bulk update failed: ' + e.message, 'error');
    }
}

function isInternalUrl(url) {
    if (!state.siteUrl) return false;
    try {
        const siteHost = new URL(state.siteUrl).host.replace(/^www\./i, '').toLowerCase();
        const linkHost = new URL(url, state.siteUrl).host.replace(/^www\./i, '').toLowerCase();
        return siteHost !== '' && siteHost === linkHost;
    } catch { return false; }
}

/* Swap old → new for exactly the occurrence that was edited (the same URL
   can also live in a different source on the same post). */
function updateLinkInState(postId, oldUrl, newUrl, source = 'content', metaKey = null) {
    for (const link of state.links) {
        if (String(link.post_id) === String(postId) && link.url === oldUrl &&
            (link.source || 'content') === source && (link.meta_key || null) === (metaKey || null)) {
            link.url = newUrl;
            link.original = newUrl;
            link.is_internal = isInternalUrl(newUrl);
        }
    }
}

function removeLinkFromState(postId, url, source = 'content', metaKey = null) {
    state.links = state.links.filter(l => !(String(l.post_id) === String(postId) && l.url === url &&
        (l.source || 'content') === (source || 'content') && (l.meta_key || null) === (metaKey || null)));
    state.selected.delete(`${postId}||${url}||${source || 'content'}||${metaKey || ''}`);
}

/* ═══════════════════════════════════════════════════════════
   Selection & bulk bar
   ═══════════════════════════════════════════════════════════ */
function syncSelectAll() {
    const all = visibleLinks();
    const selectedVisible = all.filter(l => state.selected.has(linkKey(l))).length;
    $selectAll.checked = all.length > 0 && selectedVisible === all.length;
    $selectAll.indeterminate = selectedVisible > 0 && selectedVisible < all.length;
}

function selectedLinks() {
    return [...state.selected].map(findLinkByKey).filter(Boolean);
}

function updateBulkBar() {
    const n = state.selected.size;
    $bulkBar.classList.toggle('show', n > 0);
    document.body.classList.toggle('has-bulk', n > 0);
    if (!n) return;

    $bulkCount.innerHTML = `<span class="bulk-pill">${fmt(n)}</span> selected`;

    const redirCount = selectedLinks().filter(l => state.checked[l.url]?.is_redirect && state.checked[l.url]?.redirect_url).length;
    const btn = $('btn-bulk-redir');
    btn.textContent = redirCount ? `Fix ${plural(redirCount, 'redirect')}` : 'Fix redirects';
    btn.disabled = redirCount === 0;
    btn.title = redirCount ? 'Replace each selected redirecting URL with its target' : 'None of the selected links redirect (run a check first)';
}

function clearSelection() {
    state.selected.clear();
    renderTable();
}

async function bulkFixRedirects() {
    const links = selectedLinks().filter(l => state.checked[l.url]?.is_redirect && state.checked[l.url]?.redirect_url);
    if (!links.length) { showToast('No redirecting links in the selection (run a check first)', 'error'); return; }

    const ok = await confirmDialog({
        title: `Fix ${plural(links.length, 'redirect')}`,
        message: 'Each selected URL is replaced with the target it redirects to.',
        changes: links.map(l => ({ post: postLabel(l), from: l.url, to: state.checked[l.url].redirect_url })),
        okLabel: `Fix ${plural(links.length, 'link')}`,
        tone: 'warning',
    });
    if (!ok) return;

    const btn = $('btn-bulk-redir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Fixing…';
    await runBulkUpdate(links.map(l => [l, state.checked[l.url].redirect_url]));
    updateBulkBar();
}

async function bulkApplyCustom() {
    const newUrl = normalizeUrl($bulkNewUrl.value);
    if (!newUrl) { showToast('Type the replacement URL first', 'error'); $bulkNewUrl.focus(); return; }
    if (!/^(https?:\/\/|\/)/i.test(newUrl)) { showToast('The replacement URL should start with https:// or /', 'error'); return; }
    const links = selectedLinks();
    if (!links.length) { showToast('Select links first', 'error'); return; }

    const ok = await confirmDialog({
        title: `Replace ${plural(links.length, 'link')}`,
        message: 'Every selected URL is replaced with the same new URL.',
        changes: links.map(l => ({ post: postLabel(l), from: l.url, to: newUrl })),
        okLabel: `Replace ${plural(links.length, 'link')}`,
        tone: 'success',
    });
    if (!ok) return;

    const btn = $('btn-bulk-custom');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    await runBulkUpdate(links.map(l => [l, newUrl]));
    $bulkNewUrl.value = '';
    btn.disabled = false;
    btn.textContent = 'Replace';
}

async function bulkRemoveLinks() {
    const links = selectedLinks();
    if (!links.length) { showToast('Select links first', 'error'); return; }

    const ok = await confirmDialog({
        title: `Unlink ${plural(links.length, 'link')}`,
        message: 'The <a> tags are removed. The visible anchor text stays in the post as plain text.',
        changes: links.map(l => ({ post: postLabel(l), from: l.url, to: '' })),
        okLabel: `Unlink ${plural(links.length, 'link')}`,
        tone: 'danger',
    });
    if (!ok) return;

    const btn = $('btn-bulk-remove');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Unlinking…';

    const items = links.map(l => ({ post_id: l.post_id, url: l.url, source: l.source || 'content', meta_key: l.meta_key || null }));
    try {
        const data = await postJson('bulk_remove', { items });
        if (data.status !== 'success') throw new Error(data.message || 'unknown error');
        showToast(`Unlinked ${fmt(data.removed)} of ${plural(data.total, 'link')}`, data.removed ? 'success' : 'info');

        // The API returns exactly one result per item, in order.
        const done = links.filter((_, i) => data.results?.[i]?.status === 'removed');
        logActivity(done.map(l => activityEntry(l, '')));
        for (const l of done) removeLinkFromState(l.post_id, l.url, l.source || 'content', l.meta_key || null);

        state.selected.clear();
        buildGroups();
        updateStats();
        renderTable();
    } catch (e) {
        showToast('Bulk unlink failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Unlink';
    }
}

/* ═══════════════════════════════════════════════════════════
   Pagination
   ═══════════════════════════════════════════════════════════ */
function renderPagination() {
    const total = state.totalPages;
    const current = Math.min(Math.max(1, state.page), total);
    $inpPage.value = current;
    $inpPage.max = total;
    $pageTotal.textContent = `/ ${fmt(total)}`;

    if (total <= 1) { $pagination.innerHTML = ''; return; }

    const btn = (label, page, opts = {}) =>
        `<button class="page-btn${opts.active ? ' active' : ''}" data-page="${page}" ${opts.disabled ? 'disabled' : ''}
                 ${opts.active ? 'aria-current="page"' : ''} ${opts.title ? `title="${escAttr(opts.title)}"` : ''}>${label}</button>`;

    let html = btn('‹', current - 1, { disabled: current === 1, title: 'Previous page (←)' });
    const s = Math.max(1, current - 2), e = Math.min(total, current + 2);
    if (s > 1) {
        html += btn('1', 1);
        if (s > 2) html += `<span class="page-gap">…</span>`;
    }
    for (let p = s; p <= e; p++) html += btn(String(p), p, { active: p === current });
    if (e < total) {
        if (e < total - 1) html += `<span class="page-gap">…</span>`;
        html += btn(String(total), total);
    }
    html += btn('›', current + 1, { disabled: current === total, title: 'Next page (→)' });
    $pagination.innerHTML = html;
}

function changePage(p) {
    p = Math.min(Math.max(1, p), state.totalPages || p);
    if (p === state.page) { $inpPage.value = p; return; }
    $inpPage.value = p;
    $tableWrap.scrollTop = 0;
    loadLinks();
}

/* ═══════════════════════════════════════════════════════════
   Edit modal
   ═══════════════════════════════════════════════════════════ */
let modalLink = null;

function openEditModal(key) {
    modalLink = findLinkByKey(key);
    if (!modalLink) { showToast('Link not found — reload posts', 'error'); return; }

    const c = state.checked[modalLink.url];
    $modalPostId.value = modalLink.post_id;
    $modalOldUrl.value = modalLink.url;
    $modalNewUrl.value = '';
    $modalRemoveLink.checked = false;
    const openable = isSafeHref(modalLink.url);
    $modalOpenOld.href = openable ? modalLink.url : '#';
    $modalOpenOld.hidden = !openable;
    $modalSub.textContent = `post #${modalLink.post_id}`;

    const bits = [
        `<span class="type-badge ${postTypeBadgeClass(modalLink.post_type)}">${esc(postTypeLabel(modalLink.post_type))}</span>`,
        `<span class="sbadge s-ext" title="${escAttr(modalLink.post_title || '')}">${esc(trunc(modalLink.post_title || '', 50))}</span>`,
        modalLink.source === 'faq'
            ? `<span class="sbadge s-faq" title="Stored in postmeta key ${escAttr(modalLink.meta_key || '')}">FAQ · ${esc(modalLink.meta_key || '')}</span>`
            : `<span class="sbadge s-ext">Post content</span>`,
        modalLink.occurrence_count > 1
            ? `<span class="sbadge s-chk">×${modalLink.occurrence_count} in this post</span>` : '',
        statusBadge(c),
    ].filter(Boolean);
    $modalMeta.innerHTML = bits.join('');

    const anchor = (modalLink.anchor_text || '').trim();
    $modalAnchor.innerHTML = `Anchor text: <strong>${esc(anchor || '(no text)')}</strong>`;

    const target = c?.is_redirect ? c.redirect_url : '';
    $modalUseRedirect.hidden = !target;
    $modalUseRedirect.dataset.url = target || '';

    updateModalRemoveMode();
    $modal.classList.add('open');
    setTimeout(() => $modalNewUrl.focus(), 60);
}
function closeModal() { $modal.classList.remove('open'); }

function updateModalRemoveMode() {
    const removing = $modalRemoveLink.checked;
    $modalNewUrl.disabled = removing;
    $modalNewUrl.closest('.modal-field').classList.toggle('modal-new-url-disabled', removing);
    const btn = $('modal-save-btn');
    btn.textContent = removing ? 'Unlink' : 'Save';
    btn.classList.toggle('btn-danger', removing);
    btn.classList.toggle('btn-primary', !removing);
    updateModalHint();
}

function updateModalHint() {
    if ($modalRemoveLink.checked) {
        $modalHint.className = 'modal-hint warn';
        $modalHint.textContent = 'The <a> tag will be stripped — the anchor text stays as plain text.';
        return;
    }
    const v = normalizeUrl($modalNewUrl.value);
    if (!v) {
        $modalHint.className = 'modal-hint';
        $modalHint.textContent = modalLink?.occurrence_count > 1
            ? `This URL appears ${modalLink.occurrence_count}× in the post — all occurrences are updated together.`
            : 'Paste or type the full URL, including https://';
        return;
    }
    if (v === $modalOldUrl.value.trim()) {
        $modalHint.className = 'modal-hint warn';
        $modalHint.textContent = 'Same as the current URL — nothing would change.';
        return;
    }
    if (!/^(https?:\/\/|\/)/i.test(v)) {
        $modalHint.className = 'modal-hint bad';
        $modalHint.textContent = 'URLs should start with https:// or / — double-check this one.';
        return;
    }
    $modalHint.className = 'modal-hint good';
    $modalHint.textContent = isInternalUrl(v) ? '✓ Internal link on this site.' : '✓ External link — points to another domain.';
}

async function saveModal() {
    if (!modalLink) { showToast('Link not found — reload posts', 'error'); return; }
    const link = modalLink;
    const { post_id: postId, source = 'content', meta_key: metaKey = null } = link;
    const oldUrl = link.url;
    const removing = $modalRemoveLink.checked;
    const newUrl = normalizeUrl($modalNewUrl.value);
    if (!removing && !newUrl) { showToast('Enter the new URL', 'error'); $modalNewUrl.focus(); return; }
    if (!removing && newUrl === oldUrl) { showToast('New URL is the same as the current one', 'info'); return; }

    const btn = $('modal-save-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${removing ? 'Unlinking…' : 'Saving…'}`;

    try {
        if (removing) {
            const data = await postJson('remove_link', { post_id: postId, url: oldUrl, source, meta_key: metaKey });
            if (data.status === 'success') {
                closeModal();
                logActivity([activityEntry(link, '')]);
                removeLinkFromState(postId, oldUrl, source, metaKey);
                showToast('Link removed — now plain text', 'success');
                buildGroups();
                updateStats();
                renderTable();
            } else if (data.status === 'no_change') {
                showToast('URL not found in ' + (source === 'faq' ? 'the FAQ field' : 'the post content'), 'info');
            } else {
                showToast('Error: ' + data.message, 'error');
            }
        } else if (await saveLinkUpdate(link, newUrl)) {
            closeModal();
        }
    } finally {
        btn.disabled = false;
        updateModalRemoveMode();
    }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */
function downloadCsv(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        download: `${name}-${stamp}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(`Exported ${plural(rows.length - 1, 'row')}`, 'success');
}

function exportCsv() {
    if (!state.view.length) { showToast('Nothing to export in this view', 'error'); return; }
    const rows = [['Post ID', 'Post Type', 'Post Title', 'Source', 'Link Type', 'Anchor Text', 'URL', 'Status', 'Redirect Target', 'Occurrences']];
    for (const g of state.view) {
        for (const link of g.links) {
            const c = state.checked[link.url];
            rows.push([
                g.postId, postTypeLabel(g.type), g.title,
                link.source === 'faq' ? `FAQ (${link.meta_key || ''})` : 'Post content',
                link.is_internal ? 'Internal' : 'External',
                link.anchor_text, link.url,
                c ? c.status_code : 'unchecked', c?.redirect_url || '',
                link.occurrence_count || 1,
            ]);
        }
    }
    downloadCsv('link-checker', rows);
}

async function copyVisibleUrls() {
    const urls = [...new Set(visibleLinks().map(l => l.url))];
    if (!urls.length) { showToast('No URLs in this view', 'error'); return; }
    const ok = await copyText(urls.join('\n'));
    showToast(ok ? `Copied ${plural(urls.length, 'URL')}` : 'Copy failed — clipboard blocked', ok ? 'success' : 'error');
}

/* ═══════════════════════════════════════════════════════════
   Filters & view controls
   ═══════════════════════════════════════════════════════════ */
function syncFilterUi() {
    document.querySelectorAll('#stats-row .stat-card').forEach(c => c.classList.toggle('active', c.dataset.filter === state.filter));
    document.querySelectorAll('#type-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === state.linkType));
}
function setStatusFilter(f) {
    state.filter = f;
    syncFilterUi();
    resetWindow();
    renderTable();
}
function setLinkType(t) {
    state.linkType = t;
    syncFilterUi();
    resetWindow();
    renderTable();
    updateCheckAllLabel();
}
function resetFilters() {
    state.search = '';
    state.searchTerms = [];
    $search.value = '';
    state.filter = 'all';
    state.linkType = 'all';
    syncFilterUi();
    resetWindow();
    renderTable();
    updateCheckAllLabel();
}
function applySearch(value) {
    state.search = value;
    state.searchTerms = value.toLowerCase().split(/\s+/).filter(Boolean);
    resetWindow();
    renderTable();
    updateCheckAllLabel();
}
function setDensity(compact) {
    document.body.classList.toggle('density-compact', compact);
    document.querySelector('[data-menu="compact"]').setAttribute('aria-checked', String(compact));
    lsSet(LS.density, compact ? 'compact' : 'comfortable');
}

/* Theme: an explicit choice is stored; otherwise follow the OS. */
function effectiveTheme() {
    return document.documentElement.dataset.theme
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function updateThemeButton() {
    const dark = effectiveTheme() === 'dark';
    const btn = $('btn-theme');
    btn.innerHTML = dark ? ICON.sun : ICON.moon;
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}
function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    lsSet(LS.theme, next);
    updateThemeButton();
}

function toggleMenu(open = !$menu.classList.contains('open')) {
    $menu.classList.toggle('open', open);
    $('btn-menu').setAttribute('aria-expanded', String(open));
    if (open) $menu.querySelector('.menu-item')?.focus();
}

/* Page + filters live in the URL hash, so a refresh (or a shared link)
   lands on the same view. */
function writeHash() {
    const p = new URLSearchParams();
    if (state.page > 1) p.set('page', state.page);
    if (state.filter !== 'all') p.set('status', state.filter);
    if (state.linkType !== 'all') p.set('type', state.linkType);
    if (state.search) p.set('q', state.search);
    const h = p.toString();
    const target = h ? '#' + h : location.pathname + location.search;
    if (('#' + h) !== location.hash && (h || location.hash)) history.replaceState(null, '', target);
}
function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const page = parseInt(p.get('page'), 10);
    if (page > 0) $inpPage.value = page;
    if (['ok', 'redirect', 'error', 'pending', 'duplicate'].includes(p.get('status'))) state.filter = p.get('status');
    if (['internal', 'external'].includes(p.get('type'))) state.linkType = p.get('type');
    const q = p.get('q');
    if (q) {
        $search.value = q;
        state.search = q;
        state.searchTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
    }
    syncFilterUi();
}

/* ═══════════════════════════════════════════════════════════
   Event wiring
   ═══════════════════════════════════════════════════════════ */
function bindEvents() {

    /* Header */
    $('btn-theme').addEventListener('click', toggleTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeButton);
    $('btn-activity').addEventListener('click', openDrawer);
    $('drawer-close').addEventListener('click', closeDrawer);
    $('drawer-scrim').addEventListener('click', closeDrawer);
    $('btn-activity-csv').addEventListener('click', exportActivityCsv);
    $('btn-activity-clear').addEventListener('click', () => {
        state.activity = [];
        ssSetJson(SS.activity, []);
        renderActivityCount();
        renderActivity();
    });

    /* Post type picker */
    $ptTrigger.addEventListener('click', togglePostTypePanel);
    $('btn-pt-all').addEventListener('click', () => setDraftPostTypes(true));
    $('btn-pt-none').addEventListener('click', () => setDraftPostTypes(false));
    $('btn-pt-apply').addEventListener('click', applyPostTypes);
    $ptOptions.addEventListener('change', e => {
        if (!e.target.classList.contains('pt-checkbox')) return;
        e.target.checked ? state.draftPostTypes.add(e.target.value) : state.draftPostTypes.delete(e.target.value);
    });
    document.addEventListener('click', e => {
        if ($ptSelect.classList.contains('open') && !$ptSelect.contains(e.target)) closePostTypePanel();
        if ($menu.classList.contains('open') && !$menu.contains(e.target)) toggleMenu(false);
    });

    /* Scan bar */
    $('btn-load').addEventListener('click', () => loadLinks());
    $('btn-check-all').addEventListener('click', () => checkAllLinks());
    $('btn-cancel-check').addEventListener('click', () => {
        state.cancelCheck = true;
        $('btn-cancel-check').disabled = true;
    });
    $('chk-autocheck').addEventListener('change', e => {
        lsSet(LS.autoCheck, e.target.checked ? '1' : '0');
        showToast(e.target.checked ? 'New links will be checked automatically after each load' : 'Auto-check off', 'info', 2400);
        if (e.target.checked) checkAllLinks({ recheckIfDone: false });
    });

    /* Search */
    let searchTimer = null;
    $search.addEventListener('input', e => {
        const v = e.target.value;
        $searchBox.classList.toggle('has-value', !!v);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applySearch(v), 140);
    });
    $('btn-search-clear').addEventListener('click', () => {
        $search.value = '';
        applySearch('');
        $search.focus();
    });
    $searchScope.addEventListener('change', e => {
        state.searchScope = e.target.value;
        lsSet(LS.scope, e.target.value);
        resetWindow();
        renderTable();
        updateCheckAllLabel();
    });

    /* Status filter cards */
    $('stats-row').addEventListener('click', e => {
        const card = e.target.closest('.stat-card');
        if (!card) return;
        // Clicking the active card again goes back to "all".
        setStatusFilter(card.dataset.filter === state.filter && state.filter !== 'all' ? 'all' : card.dataset.filter);
    });

    /* Link type segments */
    $('type-tabs').addEventListener('click', e => {
        const seg = e.target.closest('.seg-btn');
        if (seg) setLinkType(seg.dataset.type);
    });

    /* Any "reset filters" button, wherever it's rendered */
    document.addEventListener('click', e => {
        if (e.target.closest('[data-reset-filters]')) resetFilters();
    });

    $('sel-sort').addEventListener('change', e => {
        state.sort = e.target.value;
        lsSet(LS.sort, e.target.value);
        resetWindow();
        renderTable();
    });
    $('btn-toggle-all').addEventListener('click', toggleAllGroups);

    /* ⋯ menu */
    $('btn-menu').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    $menu.querySelector('.menu-panel').addEventListener('click', e => {
        const item = e.target.closest('[data-menu]');
        if (!item) return;
        toggleMenu(false);
        switch (item.dataset.menu) {
            case 'compact': setDensity(!document.body.classList.contains('density-compact')); break;
            case 'copy': copyVisibleUrls(); break;
            case 'csv': exportCsv(); break;
            case 'clear': forgetCheckResults(); break;
        }
    });

    /* Bulk bar */
    $('btn-bulk-redir').addEventListener('click', bulkFixRedirects);
    $('btn-bulk-remove').addEventListener('click', bulkRemoveLinks);
    $('btn-bulk-custom').addEventListener('click', bulkApplyCustom);
    $('btn-bulk-clear').addEventListener('click', clearSelection);
    $bulkNewUrl.addEventListener('keydown', e => { if (e.key === 'Enter') bulkApplyCustom(); });

    /* Table — one delegated click handler for every row action */
    $tbody.addEventListener('click', async e => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;

        if (act === 'copy') {
            const ok = await copyText(el.dataset.url || '');
            if (ok) {
                el.classList.add('copied');
                el.innerHTML = ICON.check;
                setTimeout(() => { el.classList.remove('copied'); el.innerHTML = ICON.copy; }, 1100);
            } else showToast('Copy failed — clipboard blocked', 'error');
            return;
        }
        if (act === 'check') { checkRowLink(el.dataset.url, el); return; }
        if (act === 'checkgroup') { checkGroup(el.dataset.postId, el); return; }
        if (act === 'fix') { fixSingleRedirect(el.dataset.key, el); return; }
        if (act === 'edit') { openEditModal(el.dataset.key); return; }
        if (act === 'toggle') { toggleGroup(el.dataset.postId); return; }
        if (act === 'fixgroup') { fixGroupRedirects(el.dataset.postId); return; }
        if (act === 'more') { showMoreRows(); return; }
    });

    /* Table — checkbox changes */
    $tbody.addEventListener('change', e => {
        const t = e.target;
        if (t.classList.contains('row-check')) {
            const key = t.dataset.key;
            t.checked ? state.selected.add(key) : state.selected.delete(key);
            t.closest('tr').classList.toggle('selected', t.checked);
            updateBulkBar();
            syncSelectAll();
            return;
        }
        if (t.classList.contains('group-check')) {
            const g = state.view.find(x => x.postId === t.dataset.postId);
            if (!g) return;
            g.links.forEach(l => {
                const k = linkKey(l);
                t.checked ? state.selected.add(k) : state.selected.delete(k);
            });
            renderTable();
        }
    });

    /* Select all visible */
    $selectAll.addEventListener('change', () => {
        visibleLinks().forEach(l => {
            const k = linkKey(l);
            $selectAll.checked ? state.selected.add(k) : state.selected.delete(k);
        });
        renderTable();
    });

    /* Pagination + page/per-page inputs */
    $pagination.addEventListener('click', e => {
        const btn = e.target.closest('.page-btn');
        if (btn && !btn.disabled) changePage(parseInt(btn.dataset.page, 10));
    });
    $inpPage.addEventListener('change', () => changePage(parseInt($inpPage.value, 10) || 1));
    $inpPage.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); changePage(parseInt($inpPage.value, 10) || 1); }
    });
    $inpPerPage.addEventListener('change', () => {
        lsSet(LS.perPage, $inpPerPage.value);
        $inpPage.value = 1;
        loadLinks();
    });

    /* Edit modal */
    $('modal-close').addEventListener('click', closeModal);
    $('modal-cancel-btn').addEventListener('click', closeModal);
    $('modal-save-btn').addEventListener('click', saveModal);
    $modalRemoveLink.addEventListener('change', updateModalRemoveMode);
    $modalNewUrl.addEventListener('input', updateModalHint);
    $modalNewUrl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveModal(); }
    });
    $('btn-modal-copy-old').addEventListener('click', async () => {
        const ok = await copyText($modalOldUrl.value);
        showToast(ok ? 'Current URL copied' : 'Copy failed', ok ? 'success' : 'error', 1800);
    });
    $('btn-modal-copy-current').addEventListener('click', () => {
        $modalNewUrl.value = $modalOldUrl.value;
        $modalNewUrl.focus();
        updateModalHint();
    });
    $modalUseRedirect.addEventListener('click', () => {
        $modalNewUrl.value = $modalUseRedirect.dataset.url || '';
        $modalNewUrl.focus();
        updateModalHint();
    });
    $modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); });

    /* Confirm modal */
    $confirm.addEventListener('click', e => {
        if (e.target === $confirm || e.target.closest('[data-confirm="cancel"]')) closeConfirm(false);
    });
    $('confirm-ok').addEventListener('click', () => closeConfirm(true));

    /* Help modal */
    $('btn-help').addEventListener('click', () => $helpModal.classList.add('open'));
    $('help-close').addEventListener('click', () => $helpModal.classList.remove('open'));
    $('help-ok').addEventListener('click', () => $helpModal.classList.remove('open'));
    $helpModal.addEventListener('click', e => { if (e.target === $helpModal) $helpModal.classList.remove('open'); });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', onGlobalKey);
}

function onGlobalKey(e) {
    if ($confirm.classList.contains('open')) {
        if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
        return;
    }
    const modalOpen = $modal.classList.contains('open') || $helpModal.classList.contains('open');
    const drawerOpen = document.body.classList.contains('drawer-open');

    if (e.key === 'Escape') {
        if (modalOpen) { closeModal(); $helpModal.classList.remove('open'); return; }
        if (drawerOpen) { closeDrawer(); return; }
        if ($menu.classList.contains('open')) { toggleMenu(false); $('btn-menu').focus(); return; }
        if ($ptSelect.classList.contains('open')) { closePostTypePanel(); return; }
        if (state.search) { $search.value = ''; applySearch(''); $search.blur(); return; }
        if (state.selected.size) clearSelection();
        return;
    }
    if (modalOpen || drawerOpen) return;

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '/' && !typing) { e.preventDefault(); $search.focus(); $search.select(); return; }
    if (e.key === '?' && !typing) { e.preventDefault(); $helpModal.classList.add('open'); return; }
    if (typing) return;

    switch (e.key.toLowerCase()) {
        case 'c': e.preventDefault(); checkAllLinks(); break;
        case 'r': e.preventDefault(); loadLinks(); break;
        case 'e': e.preventDefault(); toggleAllGroups(); break;
        case 'd': e.preventDefault(); setDensity(!document.body.classList.contains('density-compact')); break;
        case 'l': e.preventDefault(); openDrawer(); break;
        case 'arrowleft': if (state.page > 1) changePage(state.page - 1); break;
        case 'arrowright': if (state.page < state.totalPages) changePage(state.page + 1); break;
        case '1': setStatusFilter('all'); break;
        case '2': setStatusFilter('ok'); break;
        case '3': setStatusFilter('redirect'); break;
        case '4': setStatusFilter('error'); break;
        case '5': setStatusFilter('pending'); break;
        case '6': setStatusFilter('duplicate'); break;
    }
}

/* ═══════════════════════════════════════════════════════════
   Misc helpers
   ═══════════════════════════════════════════════════════════ */
function setTableLoading() {
    const widths = [[62, 88], [48, 72], [70, 94], [40, 66], [56, 80], [66, 90], [44, 70], [58, 84]];
    $tbody.innerHTML = widths.map(([a, u]) => `<tr class="skel-row">
        <td><span class="skel" style="width:14px;height:14px;border-radius:4px"></span></td>
        <td class="hide-mob"><span class="skel" style="width:${a}%"></span></td>
        <td><span class="skel" style="width:${u}%"></span></td>
        <td><span class="skel" style="width:56px"></span></td>
        <td><span class="skel" style="width:72px"></span></td></tr>`).join('');
}
function setTableEmpty(msg, sub) {
    $tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state is-error"><div class="es-icon">${ICON.alert}</div>
        <p>${esc(msg)}</p>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="loadLinks()">Try again</button></div></td></tr>`;
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */
function restorePrefs() {
    const perPage = lsGet(LS.perPage, '50');
    if ([...$inpPerPage.options].some(o => o.value === perPage)) $inpPerPage.value = perPage;

    $('chk-autocheck').checked = lsGet(LS.autoCheck, '1') === '1';

    setDensity(lsGet(LS.density, 'comfortable') === 'compact');
    updateThemeButton();

    const sort = lsGet(LS.sort, 'id-asc');
    if ([...$('sel-sort').options].some(o => o.value === sort)) {
        $('sel-sort').value = sort;
        state.sort = sort;
    }

    const scope = lsGet(LS.scope, 'all');
    if ([...$searchScope.options].some(o => o.value === scope)) {
        $searchScope.value = scope;
        state.searchScope = scope;
    }

    state.activity = ssGetJson(SS.activity, []);
    renderActivityCount();
}

(async function init() {
    setTableLoading();
    restorePrefs();
    readHash();
    bindEvents();
    bindDatabaseSwitcher();
    // Independent lookups — fetch them side by side.
    await Promise.all([loadDatabaseSwitcher(), loadPostTypes()]);
    loadCheckedCache();
    await loadLinks();
})();
