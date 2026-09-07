/* ═══════════════════════════════════════════════════════════
   Internal Link Checker — main.js (v3)

   UI rewrite notes:
   · URLs are never truncated. Every URL (and every redirect target) is
     rendered in full, in a monospace face, split into scheme / host / path
     so it can be read, compared and copied at a glance.
   · Redirect targets are diffed against the source URL — the shared prefix
     is dimmed, the part that actually changed is highlighted.
   · Search supports multiple space-separated terms (AND), an optional field
     scope, and highlights every match in place.
   · Row rendering uses event delegation + data attributes instead of inline
     onclick handlers, so URLs containing quotes/ampersands can't break out.
   The API contract (api.php actions + payload shapes) is unchanged.
   ═══════════════════════════════════════════════════════════ */

const API = 'api.php';
const CONCURRENCY = 5;

/* ── State ─────────────────────────────────────────────────── */
const state = {
    links: [],            // flat array from API
    groups: [],           // [{ postId, title, type, links[] }] — array, so sort order sticks
    checked: {},          // { url: { status_code, is_redirect, redirect_url } }
    filter: 'all',        // all | ok | redirect | error | pending | duplicate
    linkType: 'all',      // all | internal | external
    search: '',
    searchScope: 'all',   // all | url | anchor | title
    searchTerms: [],      // lowercased, space split
    sort: 'id-asc',
    selected: new Set(),  // linkKey(link)
    collapsed: new Set(), // collapsed post IDs
    isLoading: false,
    isChecking: false,
    cancelCheck: false,
    checkProgress: 0,
    checkTotal: 0,
    page: 1,
    totalPages: 1,
    totalPosts: 0,
    postCount: 0,         // posts on the current page that actually have links
    siteUrl: '',
    postTypes: [],
    availablePostTypes: [],
    draftPostTypes: new Set(),
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
const $progressWrap = $('progress-wrap');
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

const $modal = $('edit-modal');
const $modalOldUrl = $('modal-old-url');
const $modalNewUrl = $('modal-new-url');
const $modalPostId = $('modal-post-id');
const $modalRemoveLink = $('modal-remove-link');
const $modalHint = $('modal-hint');
const $modalMeta = $('modal-meta');
const $modalSub = $('modal-sub');
const $modalUseRedirect = $('btn-modal-use-redirect');
const $modalOpenOld = $('btn-modal-open-old');
const $helpModal = $('help-modal');

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

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, type = 'info', ms = 3600) {
    const el = document.createElement('div');
    el.className = `toast-item toast-${type}`;
    el.textContent = msg;
    $toast.appendChild(el);
    setTimeout(() => el.remove(), ms);
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
    setTableLoading('Loading posts…');

    let page = Math.max(1, parseInt($inpPage.value, 10) || 1);
    const perPage = Math.max(1, parseInt($inpPerPage.value, 10) || 50);
    $inpPage.value = page;

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
        state.checked = {};
        state.selected.clear();
        state.collapsed.clear();

        state.siteUrl = data.site_url || '';
        const $siteLabel = $('site-url-label');
        $siteLabel.textContent = state.siteUrl.replace(/^https?:\/\//, '');
        $siteLabel.href = state.siteUrl || '#';

        buildGroups();
        updateStats();
        renderTable();
        renderPagination();
        showToast(`Loaded ${plural(data.link_count, 'link')} from page ${data.page}`, 'success');
    } catch (e) {
        showToast('Failed to load: ' + e.message, 'error');
        setTableEmpty('Failed to reach the API.', e.message);
    } finally {
        state.isLoading = false;
        $selectAll.checked = false;
        $selectAll.indeterminate = false;
    }
}

/* A URL can exist both as a post_content <a> and inside an FAQ answer field
   on the same post, so post_id + url alone can't identify an occurrence. */
function linkKey(link) {
    return `${link.post_id}||${link.url}||${link.source || 'content'}||${link.meta_key || ''}`;
}
function findLinkByKey(key) {
    return state.links.find(l => linkKey(l) === key);
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
    if (n === 0) $ptTriggerLabel.textContent = 'Post Types';
    else if (n <= 2) $ptTriggerLabel.textContent = state.postTypes.map(postTypeLabel).join(', ');
    else $ptTriggerLabel.textContent = `${n} Types Selected`;
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
    for (const link of state.links) {
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
   used to scope "Check Links" to what the user is actually looking at. */
function typeFilteredLinks() {
    return state.links.filter(l => matchesType(l) && matchesSearch(l));
}

function groupStats(links) {
    let redirects = 0, errors = 0;
    for (const l of links) {
        const c = state.checked[l.url];
        if (!c) continue;
        if (c.is_redirect && c.redirect_url) redirects++;
        else if (c.status_code === 0 || c.status_code >= 400) errors++;
    }
    return { redirects, errors };
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
function visibleLinks() {
    return filteredGroups().flatMap(g => g.links);
}

/* ═══════════════════════════════════════════════════════════
   Checking
   ═══════════════════════════════════════════════════════════ */
async function checkAllLinks() {
    if (state.isChecking) return;
    const unchecked = typeFilteredLinks().filter(l => !state.checked[l.url]);
    if (!unchecked.length) { showToast('Every link in this view is already checked', 'info'); return; }

    // The same URL can appear on many posts — check each distinct URL once.
    const urls = [...new Set(unchecked.map(l => l.url))];

    state.isChecking = true;
    state.cancelCheck = false;
    state.checkTotal = urls.length;
    state.checkProgress = 0;
    $progressWrap.classList.add('visible');
    updateProgress();
    setCheckAllBusy(true);

    // Repainting the whole table after every batch gets expensive on big
    // pages, so live feedback is throttled — the final render happens once
    // the run finishes either way.
    let lastPaint = 0;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
        if (state.cancelCheck) break;
        const batch = urls.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(u => checkSingleUrl(u)));
        state.checkProgress += batch.length;
        updateProgress();
        if (Date.now() - lastPaint > 400) {
            updateStats();
            renderTable();
            lastPaint = Date.now();
        }
    }

    const cancelled = state.cancelCheck;
    state.isChecking = false;
    state.cancelCheck = false;
    $progressWrap.classList.remove('visible');
    setCheckAllBusy(false);
    updateStats();
    renderTable();
    showToast(cancelled ? `Stopped after ${fmt(state.checkProgress)} URLs` : 'All links checked', cancelled ? 'info' : 'success');
}

function setCheckAllBusy(busy) {
    const btn = $('btn-check-all');
    btn.disabled = busy;
    if (busy) $('check-all-label').textContent = 'Checking…';
    else updateCheckAllLabel();
}

async function checkSingleUrl(url) {
    try {
        const res = await fetch(`${API}?action=check_status&url=${encodeURIComponent(url)}`);
        state.checked[url] = await res.json();
    } catch {
        state.checked[url] = { status_code: 0, is_redirect: false, redirect_url: null };
    }
}

async function checkRowLink(url, btn) {
    btn.disabled = true;
    const prev = btn.innerHTML;
    btn.innerHTML = '<span class="spin spin-dark"></span>';
    await checkSingleUrl(url);
    updateStats();
    renderTable();
    // renderTable() replaces the button, so only restore it if it survived
    // (e.g. the row got filtered out and the node is detached).
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = prev; }
}

function updateProgress() {
    const pct = state.checkTotal > 0 ? Math.round((state.checkProgress / state.checkTotal) * 100) : 0;
    $progressFill.style.width = pct + '%';
    $progressText.textContent = `Checking ${fmt(state.checkProgress)} of ${fmt(state.checkTotal)} URLs — ${pct}%`;
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

    $('stat-total').textContent = fmt(state.links.length);
    $('stat-ok').textContent = fmt(ok);
    $('stat-rd').textContent = fmt(rd);
    $('stat-err').textContent = fmt(err);
    $('stat-pend').textContent = fmt(pend);
    $('stat-dup').textContent = fmt(dupe);

    const typeCounts = { all: state.links.length, internal, external };
    document.querySelectorAll('#type-tabs .seg-btn').forEach(btn => {
        const fc = btn.querySelector('.fc');
        if (fc) fc.textContent = fmt(typeCounts[btn.dataset.type] ?? 0);
    });

    updateCheckAllLabel();
}

function updateCheckAllLabel() {
    if (state.isChecking) return;
    const pending = new Set(typeFilteredLinks().filter(l => !state.checked[l.url]).map(l => l.url)).size;
    const typeName = state.linkType === 'internal' ? 'Internal' : state.linkType === 'external' ? 'External' : 'All';
    const el = $('check-all-label');
    if (el) el.textContent = pending ? `Check ${typeName} (${fmt(pending)})` : `Re-check ${typeName}`;
}

function updateCounters(shownLinks, shownGroups) {
    const total = state.links.length;
    const filtered = state.filter !== 'all' || state.linkType !== 'all' || state.searchTerms.length > 0;

    $filterNote.innerHTML = filtered
        ? `Showing <strong>${fmt(shownLinks)}</strong> of <strong>${fmt(total)}</strong> links
           <button class="btn btn-quiet btn-sm" id="btn-reset-filters" style="margin-left:4px">Reset filters</button>`
        : `<strong>${fmt(total)}</strong> links across <strong>${fmt(state.postCount)}</strong> posts`;

    $footerInfo.innerHTML = `<strong>${fmt(shownGroups)}</strong> post${shownGroups === 1 ? '' : 's'} in view ·
        <strong>${fmt(state.totalPosts)}</strong> published posts scanned`;

    $searchCount.textContent = state.searchTerms.length ? `${fmt(shownLinks)} match${shownLinks === 1 ? '' : 'es'}` : '';
    $searchBox.classList.toggle('has-value', !!state.search);
}

/* ═══════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════ */
const ICON = {
    refresh: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    pencil: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    chevron: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    wp: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
};

function renderTable() {
    const scrollTop = $tableWrap ? $tableWrap.scrollTop : 0;
    const groups = filteredGroups();
    const shownLinks = groups.reduce((n, g) => n + g.links.length, 0);

    if (!groups.length) {
        $tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml()}</td></tr>`;
        updateCounters(0, 0);
        updateBulkBar();
        syncSelectAll(0);
        return;
    }

    const terms = state.searchTerms;
    const parts = [];

    for (const g of groups) {
        const collapsed = state.collapsed.has(g.postId);
        const { redirects, errors } = groupStats(g.links);
        const allSel = g.links.every(l => state.selected.has(linkKey(l)));

        const metaBits = [`${plural(g.links.length, 'link')}`];
        if (redirects) metaBits.push(`<span class="group-redir-count">${plural(redirects, 'redirect')}</span>`);
        if (errors) metaBits.push(`<span class="group-err-count">${plural(errors, 'error')}</span>`);

        const viewUrl = state.siteUrl ? `${state.siteUrl}/?p=${encodeURIComponent(g.postId)}` : '';
        const editUrl = state.siteUrl ? `${state.siteUrl}/wp-admin/post.php?post=${encodeURIComponent(g.postId)}&action=edit` : '';

        parts.push(`<tr class="group-row${collapsed ? ' is-collapsed' : ''}" data-post-id="${escAttr(g.postId)}">
          <td colspan="5">
            <div class="group-row-inner">
              <button class="group-toggle" data-act="toggle" data-post-id="${escAttr(g.postId)}"
                      title="${collapsed ? 'Expand' : 'Collapse'} this post" aria-label="Toggle post group">${ICON.chevron}</button>
              <span class="type-badge ${postTypeBadgeClass(g.type)}">${esc(postTypeLabel(g.type))}</span>
              ${viewUrl
                ? `<a class="group-title" href="${escAttr(viewUrl)}" target="_blank" rel="noopener" title="${escAttr(g.title)} — open on the site">${hl(g.title, terms)}</a>`
                : `<span class="group-title" title="${escAttr(g.title)}">${hl(g.title, terms)}</span>`}
              <span class="group-post-id">#${esc(g.postId)}</span>
              <span class="group-meta">${metaBits.join(' · ')}</span>
              <span class="group-actions">
                ${redirects ? `<button class="btn btn-warning btn-sm" data-act="fixgroup" data-post-id="${escAttr(g.postId)}"
                        title="Replace every redirecting URL in this post with its target">Fix ${redirects}</button>` : ''}
                ${editUrl ? `<a class="icon-btn" href="${escAttr(editUrl)}" target="_blank" rel="noopener" title="Open in the WordPress editor">${ICON.wp}</a>` : ''}
                <label class="group-select-all" title="Select every link shown for this post">
                  <input type="checkbox" class="group-check" data-post-id="${escAttr(g.postId)}" ${allSel ? 'checked' : ''}> All
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
        }
    }

    $tbody.innerHTML = parts.join('');
    if ($tableWrap) $tableWrap.scrollTop = scrollTop;

    updateCounters(shownLinks, groups.length);
    updateBulkBar();
    syncSelectAll(shownLinks);
}

function rowStateClass(c) {
    if (!c) return '';
    if (c.status_code >= 200 && c.status_code < 300) return ' row-ok';
    if (c.status_code >= 300 && c.status_code < 400) return ' row-redirect';
    return ' row-error';
}

function emptyStateHtml() {
    if (!state.links.length) {
        return `<div class="empty-state"><div class="icon">🔗</div>
            <p>No links found on this page of posts.</p>
            <div class="sub">Try another page, a larger page size, or more content types.</div></div>`;
    }
    return `<div class="empty-state"><div class="icon">🔍</div>
        <p>No links match the current filters.</p>
        <div class="sub">${state.searchTerms.length ? `Search: “${esc(state.search)}”` : 'Adjust the status or link-type filter.'}</div>
        <button class="btn btn-ghost btn-sm" id="btn-reset-filters-empty">Reset filters</button></div>`;
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
          ${!c
            ? `<button class="btn btn-ghost btn-sm" data-act="check" data-url="${escAttr(link.url)}" title="Check this URL now">Check</button>`
            : `<button class="icon-btn" data-act="check" data-url="${escAttr(link.url)}" title="Re-check this URL">${ICON.refresh}</button>`}
          ${c?.is_redirect && c.redirect_url
            ? `<button class="btn btn-warning btn-sm" data-act="fix" data-key="${escAttr(key)}" title="Replace this URL with its redirect target">Fix</button>`
            : ''}
          <button class="icon-btn" data-act="edit" data-key="${escAttr(key)}" title="Edit or unlink this link">${ICON.pencil}</button>
        </div>
      </td>`;
}

function statusBadge(c) {
    if (!c) return `<span class="sbadge s-pend">Pending</span>`;
    const code = c.status_code;
    if (code === 0) return `<span class="sbadge s-4xx" title="No response — timeout, DNS failure or blocked request">Timeout</span>`;
    if (code >= 200 && code < 300) return `<span class="sbadge s-200" title="HTTP ${code} — reachable">✓ ${code}</span>`;
    if (code >= 300 && code < 400) return `<span class="sbadge s-3xx" title="HTTP ${code} — redirects to another URL">⇒ ${code}</span>`;
    return `<span class="sbadge s-4xx" title="HTTP ${code} — broken or unavailable">✗ ${code}</span>`;
}

/* ── Collapse / expand ─────────────────────────────────────── */
function toggleGroup(postId) {
    state.collapsed.has(postId) ? state.collapsed.delete(postId) : state.collapsed.add(postId);
    renderTable();
    updateToggleAllLabel();
}
function toggleAllGroups() {
    const groups = filteredGroups();
    const anyOpen = groups.some(g => !state.collapsed.has(g.postId));
    if (anyOpen) groups.forEach(g => state.collapsed.add(g.postId));
    else groups.forEach(g => state.collapsed.delete(g.postId));
    renderTable();
    updateToggleAllLabel();
}
function updateToggleAllLabel() {
    const groups = filteredGroups();
    const anyOpen = groups.some(g => !state.collapsed.has(g.postId));
    $('btn-toggle-all').textContent = anyOpen ? 'Collapse all' : 'Expand all';
}

/* ═══════════════════════════════════════════════════════════
   Writes — update / remove (API payloads unchanged)
   ═══════════════════════════════════════════════════════════ */
async function fixGroupRedirects(postId) {
    const group = state.groups.find(g => g.postId === String(postId));
    if (!group) return;

    const updates = group.links
        .filter(l => state.checked[l.url]?.is_redirect && state.checked[l.url]?.redirect_url)
        .map(l => ({
            post_id: parseInt(postId, 10), old_url: l.url,
            new_url: state.checked[l.url].redirect_url,
            source: l.source || 'content', meta_key: l.meta_key || null,
        }));

    if (!updates.length) { showToast('No redirecting links in this post', 'error'); return; }
    if (!confirm(`Fix ${updates.length} redirect(s) in "${group.title}"?\n\nEach URL is replaced with its redirect target.`)) return;

    await runBulkUpdate(updates, true);
}

async function fixSingleRedirect(key, btn) {
    const link = findLinkByKey(key);
    if (!link) { showToast('Link not found — reload posts', 'error'); return; }
    const newUrl = state.checked[link.url]?.redirect_url;
    if (!newUrl) { showToast('No redirect target found — check the link first', 'error'); return; }

    const { post_id: postId, url: oldUrl, source = 'content', meta_key: metaKey = null } = link;
    if (!confirm(`Replace:\n${oldUrl}\n\nWith:\n${newUrl}`)) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';

    try {
        const res = await fetch(`${API}?action=update_link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: postId, old_url: oldUrl, new_url: newUrl, source, meta_key: metaKey }),
        });
        const data = await res.json();

        if (data.status === 'success' || data.status === 'no_change') {
            updateLinkInState(postId, oldUrl, newUrl, source, metaKey);
            showToast(data.status === 'success' ? 'Link updated' : 'No change in DB', data.status === 'success' ? 'success' : 'info');
            await checkSingleUrl(newUrl);
            buildGroups();
            updateStats();
            renderTable();
        } else {
            showToast('Error: ' + data.message, 'error');
            if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Fix'; }
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
        if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Fix'; }
    }
}

async function runBulkUpdate(updates, recheckAfter = true) {
    try {
        const res = await fetch(`${API}?action=bulk_update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        showToast(`Updated ${fmt(data.updated)} of ${fmt(data.total)} link(s)`, data.updated ? 'success' : 'info');

        if (recheckAfter) {
            for (const u of updates) {
                const usrc = u.source || 'content', umeta = u.meta_key || null;
                if (data.results?.find(r => r.post_id === u.post_id && r.status === 'updated' &&
                    (r.source || 'content') === usrc && (r.meta_key || null) === umeta)) {
                    updateLinkInState(u.post_id, u.old_url, u.new_url, usrc, umeta);
                }
            }
            const newUrls = [...new Set(updates.map(u => u.new_url))];
            showToast(`Re-checking ${plural(newUrls.length, 'URL')}…`, 'info', 2200);
            await Promise.all(newUrls.map(u => checkSingleUrl(u)));
        }

        state.selected.clear();
        buildGroups();
        updateStats();
        renderTable();
        return data;
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
    if (state.checked[oldUrl]) {
        if (!state.checked[newUrl]) state.checked[newUrl] = state.checked[oldUrl];
        if (!state.links.some(l => l.url === oldUrl)) delete state.checked[oldUrl];
    }
}

function removeLinkFromState(postId, url, source = 'content', metaKey = null) {
    state.links = state.links.filter(l => !(String(l.post_id) === String(postId) && l.url === url &&
        (l.source || 'content') === (source || 'content') && (l.meta_key || null) === (metaKey || null)));
    if (!state.links.some(l => l.url === url)) delete state.checked[url];
    state.selected.delete(`${postId}||${url}||${source || 'content'}||${metaKey || ''}`);
}

/* ═══════════════════════════════════════════════════════════
   Selection & bulk bar
   ═══════════════════════════════════════════════════════════ */
function syncSelectAll(shownCount) {
    const selectedVisible = visibleLinks().filter(l => state.selected.has(linkKey(l))).length;
    $selectAll.checked = shownCount > 0 && selectedVisible === shownCount;
    $selectAll.indeterminate = selectedVisible > 0 && selectedVisible < shownCount;
}

function updateBulkBar() {
    const n = state.selected.size;
    if (!n) { $bulkBar.classList.remove('show'); return; }

    $bulkBar.classList.add('show');
    $bulkCount.innerHTML = `<span class="bulk-pill">${fmt(n)}</span> link${n === 1 ? '' : 's'} selected`;

    const redirCount = [...state.selected].filter(key => {
        const link = findLinkByKey(key);
        return link && state.checked[link.url]?.is_redirect && state.checked[link.url]?.redirect_url;
    }).length;

    const btn = $('btn-bulk-redir');
    btn.textContent = redirCount ? `⇒ Fix ${redirCount} Redirect${redirCount === 1 ? '' : 's'}` : '⇒ Fix Redirects';
    btn.disabled = redirCount === 0;
}

function clearSelection() {
    state.selected.clear();
    renderTable();
}

async function bulkFixRedirects() {
    const updates = [];
    for (const key of state.selected) {
        const link = findLinkByKey(key);
        if (!link) continue;
        const c = state.checked[link.url];
        if (!c?.is_redirect || !c.redirect_url) continue;
        updates.push({
            post_id: link.post_id, old_url: link.url, new_url: c.redirect_url,
            source: link.source || 'content', meta_key: link.meta_key || null,
        });
    }
    if (!updates.length) { showToast('No redirecting links in the selection (run Check first)', 'error'); return; }
    if (!confirm(`Fix ${updates.length} redirect URL(s)?\n\nEach one is replaced with its redirect target.`)) return;

    const btn = $('btn-bulk-redir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Fixing…';
    await runBulkUpdate(updates, true);
    btn.disabled = false;
    btn.textContent = '⇒ Fix Redirects';
}

async function bulkApplyCustom() {
    const newUrl = normalizeUrl($bulkNewUrl.value);
    if (!newUrl) { showToast('Type the replacement URL first', 'error'); return; }
    if (!state.selected.size) { showToast('Select links first', 'error'); return; }
    if (!confirm(`Replace ${state.selected.size} selected URL(s) with:\n${newUrl}`)) return;

    const updates = [...state.selected].map(findLinkByKey).filter(Boolean)
        .map(link => ({
            post_id: link.post_id, old_url: link.url, new_url: newUrl,
            source: link.source || 'content', meta_key: link.meta_key || null,
        }));

    const btn = $('btn-bulk-custom');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Applying…';
    await runBulkUpdate(updates, true);
    $bulkNewUrl.value = '';
    btn.disabled = false;
    btn.textContent = 'Apply';
}

async function bulkRemoveLinks() {
    if (!state.selected.size) { showToast('Select links first', 'error'); return; }

    const items = [...state.selected].map(findLinkByKey).filter(Boolean)
        .map(link => ({
            post_id: link.post_id, url: link.url,
            source: link.source || 'content', meta_key: link.meta_key || null,
        }));
    if (!items.length) { showToast('Nothing to unlink', 'error'); return; }
    if (!confirm(`Unlink ${items.length} selected link(s)?\n\nThe visible text stays, the href is removed.`)) return;

    const btn = $('btn-bulk-remove');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Unlinking…';

    try {
        const res = await fetch(`${API}?action=bulk_remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        });
        const data = await res.json();
        showToast(`Unlinked ${fmt(data.removed)} of ${fmt(data.total)} link(s)`, data.removed ? 'success' : 'info');

        for (const it of items) {
            const removed = data.results?.find(r => r.post_id === it.post_id && r.url === it.url &&
                (r.source || 'content') === (it.source || 'content') && (r.meta_key || null) === (it.meta_key || null) &&
                r.status === 'removed');
            if (removed) removeLinkFromState(it.post_id, it.url, it.source, it.meta_key);
        }

        state.selected.clear();
        buildGroups();
        updateStats();
        renderTable();
    } catch (e) {
        showToast('Bulk unlink failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✕ Unlink';
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
                 ${opts.title ? `title="${escAttr(opts.title)}"` : ''}>${label}</button>`;

    let html = btn('‹', current - 1, { disabled: current === 1, title: 'Previous page' });
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
    html += btn('›', current + 1, { disabled: current === total, title: 'Next page' });
    $pagination.innerHTML = html;
}

function changePage(p) {
    p = Math.min(Math.max(1, p), state.totalPages || p);
    if (p === state.page) return;
    $inpPage.value = p;
    loadLinks();
    if ($tableWrap) $tableWrap.scrollTop = 0;
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
        `<span class="sbadge s-pend" title="${escAttr(modalLink.post_title || '')}">${esc(trunc(modalLink.post_title || '', 46))}</span>`,
        modalLink.source === 'faq'
            ? `<span class="sbadge s-faq" title="Stored in postmeta key ${escAttr(modalLink.meta_key || '')}">FAQ · ${esc(modalLink.meta_key || '')}</span>`
            : `<span class="sbadge s-ext">Post content</span>`,
        modalLink.occurrence_count > 1
            ? `<span class="sbadge s-chk">×${modalLink.occurrence_count} in this post</span>` : '',
        statusBadge(c),
    ].filter(Boolean);
    $modalMeta.innerHTML = bits.join('');

    const target = c?.is_redirect ? c.redirect_url : '';
    $modalUseRedirect.hidden = !target;
    $modalUseRedirect.dataset.url = target || '';

    updateModalRemoveMode();
    updateModalHint();
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
            : 'Paste or edit the full URL, including https://';
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
    $modalHint.textContent = isInternalUrl(v) ? 'Internal link on this site.' : 'External link — points to another domain.';
}

async function saveModal() {
    if (!modalLink) { showToast('Link not found — reload posts', 'error'); return; }
    const { post_id: postId, source = 'content', meta_key: metaKey = null } = modalLink;
    const oldUrl = $modalOldUrl.value.trim();
    const removing = $modalRemoveLink.checked;
    const newUrl = normalizeUrl($modalNewUrl.value);
    if (!removing && !newUrl) { showToast('Enter the new URL', 'error'); return; }
    if (!removing && newUrl === oldUrl) { showToast('New URL is the same as the current one', 'info'); return; }

    const btn = $('modal-save-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${removing ? 'Unlinking…' : 'Saving…'}`;

    try {
        const res = await fetch(`${API}?action=${removing ? 'remove_link' : 'update_link'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(removing
                ? { post_id: postId, url: oldUrl, source, meta_key: metaKey }
                : { post_id: postId, old_url: oldUrl, new_url: newUrl, source, meta_key: metaKey }),
        });
        const data = await res.json();

        if (data.status === 'success' && removing) {
            closeModal();
            removeLinkFromState(postId, oldUrl, source, metaKey);
            showToast('Link removed — now plain text', 'success');
            buildGroups();
            updateStats();
            renderTable();
        } else if (data.status === 'success') {
            closeModal();
            updateLinkInState(postId, oldUrl, newUrl, source, metaKey);
            showToast('Saved — re-checking the new URL…', 'success');
            await checkSingleUrl(newUrl);
            buildGroups();
            updateStats();
            renderTable();
        } else if (data.status === 'no_change') {
            showToast('URL not found in ' + (source === 'faq' ? 'the FAQ field' : 'the post content'), 'info');
        } else {
            showToast('Error: ' + data.message, 'error');
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        updateModalRemoveMode();
    }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */
function exportCsv() {
    const groups = filteredGroups();
    if (!groups.length) { showToast('Nothing to export in this view', 'error'); return; }

    const rows = [['Post ID', 'Post Type', 'Post Title', 'Source', 'Link Type', 'Anchor Text', 'URL', 'Status', 'Redirect Target', 'Occurrences']];
    for (const g of groups) {
        for (const link of g.links) {
            const c = state.checked[link.url];
            rows.push([
                g.postId, postTypeLabel(g.type), g.title,
                link.source === 'faq' ? `FAQ (${link.meta_key || ''})` : 'Post content',
                link.is_internal ? 'Internal' : 'External',
                link.anchor_text, link.url,
                c ? c.status_code : 'pending', c?.redirect_url || '',
                link.occurrence_count || 1,
            ]);
        }
    }
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        download: `link-checker-${stamp}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Exported ${plural(rows.length - 1, 'row')}`, 'success');
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
function setStatusFilter(f) {
    state.filter = f;
    document.querySelectorAll('#stats-row .stat-card').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
    renderTable();
    updateToggleAllLabel();
}
function setLinkType(t) {
    state.linkType = t;
    document.querySelectorAll('#type-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === t));
    renderTable();
    updateCheckAllLabel();
    updateToggleAllLabel();
}
function resetFilters() {
    state.search = '';
    state.searchTerms = [];
    $search.value = '';
    setLinkType('all');
    setStatusFilter('all');
}
function applySearch(value) {
    state.search = value;
    state.searchTerms = value.toLowerCase().split(/\s+/).filter(Boolean);
    renderTable();
    updateCheckAllLabel();
}
function setDensity(compact) {
    document.body.classList.toggle('density-compact', compact);
    const btn = $('btn-density');
    btn.textContent = compact ? 'Comfortable' : 'Compact';
    btn.classList.toggle('btn-on', compact);
    lsSet(LS.density, compact ? 'compact' : 'comfortable');
}

/* ═══════════════════════════════════════════════════════════
   Event wiring
   ═══════════════════════════════════════════════════════════ */
function bindEvents() {

    /* Toolbar */
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
    });

    $('btn-load').addEventListener('click', () => loadLinks());
    $('btn-check-all').addEventListener('click', () => checkAllLinks());
    $('btn-cancel-check').addEventListener('click', () => {
        state.cancelCheck = true;
        $('btn-cancel-check').disabled = true;
        setTimeout(() => { $('btn-cancel-check').disabled = false; }, 1200);
    });
    $('btn-csv').addEventListener('click', exportCsv);
    $('btn-copy-urls').addEventListener('click', copyVisibleUrls);

    /* Search */
    let searchTimer = null;
    $search.addEventListener('input', e => {
        const v = e.target.value;
        $searchBox.classList.toggle('has-value', !!v);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applySearch(v), 130);
    });
    $('btn-search-clear').addEventListener('click', () => {
        $search.value = '';
        applySearch('');
        $search.focus();
    });
    $searchScope.addEventListener('change', e => {
        state.searchScope = e.target.value;
        lsSet(LS.scope, e.target.value);
        renderTable();
        updateCheckAllLabel();
    });

    /* Auto-check preference */
    $('chk-autocheck').addEventListener('change', e => {
        lsSet(LS.autoCheck, e.target.checked ? '1' : '0');
        showToast(e.target.checked ? 'Links will be checked automatically after loading' : 'Auto-check off', 'info', 2400);
    });

    /* Status filter cards */
    $('stats-row').addEventListener('click', e => {
        const card = e.target.closest('.stat-card');
        if (card) setStatusFilter(card.dataset.filter);
    });

    /* Link type segments + reset-filters button */
    document.querySelector('.viewbar').addEventListener('click', e => {
        const seg = e.target.closest('#type-tabs .seg-btn');
        if (seg) { setLinkType(seg.dataset.type); return; }
        if (e.target.closest('#btn-reset-filters')) resetFilters();
    });

    $('sel-sort').addEventListener('change', e => {
        state.sort = e.target.value;
        lsSet(LS.sort, e.target.value);
        renderTable();
    });
    $('btn-toggle-all').addEventListener('click', toggleAllGroups);
    $('btn-density').addEventListener('click', () => setDensity(!document.body.classList.contains('density-compact')));

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
        if (act === 'fix') { fixSingleRedirect(el.dataset.key, el); return; }
        if (act === 'edit') { openEditModal(el.dataset.key); return; }
        if (act === 'toggle') { toggleGroup(el.dataset.postId); return; }
        if (act === 'fixgroup') { fixGroupRedirects(el.dataset.postId); return; }
    });

    /* Table — checkbox changes */
    $tbody.addEventListener('change', e => {
        const t = e.target;
        if (t.classList.contains('row-check')) {
            const key = t.dataset.key;
            t.checked ? state.selected.add(key) : state.selected.delete(key);
            t.closest('tr').classList.toggle('selected', t.checked);
            updateBulkBar();
            syncSelectAll(visibleLinks().length);
            return;
        }
        if (t.classList.contains('group-check')) {
            const g = filteredGroups().find(x => x.postId === t.dataset.postId);
            if (!g) return;
            g.links.forEach(l => {
                const k = linkKey(l);
                t.checked ? state.selected.add(k) : state.selected.delete(k);
            });
            renderTable();
        }
    });

    /* Reset-filters button inside the empty state */
    $tbody.addEventListener('click', e => {
        if (e.target.closest('#btn-reset-filters-empty')) resetFilters();
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

    /* Modal */
    $('modal-close').addEventListener('click', closeModal);
    $('modal-cancel-btn').addEventListener('click', closeModal);
    $('modal-save-btn').addEventListener('click', saveModal);
    $modalRemoveLink.addEventListener('change', updateModalRemoveMode);
    $modalNewUrl.addEventListener('input', updateModalHint);
    $modalNewUrl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveModal(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveModal(); }
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

    /* Help modal */
    $('btn-help').addEventListener('click', () => $helpModal.classList.add('open'));
    $('help-close').addEventListener('click', () => $helpModal.classList.remove('open'));
    $('help-ok').addEventListener('click', () => $helpModal.classList.remove('open'));
    $helpModal.addEventListener('click', e => { if (e.target === $helpModal) $helpModal.classList.remove('open'); });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', onGlobalKey);
}

function onGlobalKey(e) {
    const modalOpen = $modal.classList.contains('open') || $helpModal.classList.contains('open');

    if (e.key === 'Escape') {
        if (modalOpen) { closeModal(); $helpModal.classList.remove('open'); return; }
        if ($ptSelect.classList.contains('open')) { closePostTypePanel(); return; }
        if (state.search) { $search.value = ''; applySearch(''); return; }
        if (state.selected.size) clearSelection();
        return;
    }
    if (modalOpen) return;

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
function setTableLoading(msg) {
    $tbody.innerHTML = `<tr><td colspan="5"><div class="skeleton-cell"><span class="spin spin-dark"></span>${esc(msg)}</div></td></tr>`;
}
function setTableEmpty(msg, sub) {
    $tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="icon">⚠️</div>
        <p>${esc(msg)}</p>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div></td></tr>`;
}
function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */
function restorePrefs() {
    const perPage = lsGet(LS.perPage, '50');
    if ([...$inpPerPage.options].some(o => o.value === perPage)) $inpPerPage.value = perPage;

    const autoCheck = lsGet(LS.autoCheck, '1') === '1';
    $('chk-autocheck').checked = autoCheck;

    setDensity(lsGet(LS.density, 'comfortable') === 'compact');

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
}

(async function init() {
    restorePrefs();
    bindEvents();
    await loadPostTypes();
    await loadLinks();
    updateToggleAllLabel();
    if ($('chk-autocheck').checked) checkAllLinks();
})();
