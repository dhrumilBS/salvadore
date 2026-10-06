/* ══════════════════════════ Link Fixer tab ══════════════════════════
 * The former ../post-content tool. Every <a href> in post content AND in
 * ACF FAQ answer fields (api/fixer_list.php), grouped per post, live-checked
 * through the shared LinkStatus checker, and fixable in place: replace a URL
 * (or just part of it), swap a redirect for its target, or unlink it while
 * keeping the anchor text. Every write is previewed in confirmDialog() and
 * journaled server-side, so it shows up in History and can be undone.
 *
 * Writes match a link by its raw `href` (exactly as stored), never by the
 * decoded absolute `url` shown on screen - that's what makes relative and
 * &amp;-encoded hrefs editable. Element IDs are fx-prefixed. */

const FX_ROW_WINDOW = 300; // link rows rendered per chunk; more are added on scroll
const FX_WRITE_CHUNK = 200;
const FX_DEFAULT_TYPES = ['post', 'page', 'whitepaper', 'case-studies'];

const FX_TYPE_LABELS = {
    post: 'Blog Posts', page: 'Pages', whitepaper: 'Whitepapers', 'case-studies': 'Case Studies',
    jobs: 'Jobs', job: 'Jobs (draft)', events: 'Events', event: 'Events (draft)', faq: 'FAQ Entries', alternatives: 'Alternatives',
};

const fx = {
    links: [],            // flat list from fixer_list.php
    index: new Map(),     // fxKey -> link
    groups: [],           // [{postId, title, type, status, permalink, links[]}]
    view: [],             // filtered + sorted groups from the last render
    filter: 'all',        // all | ok | redirect | error | pending | duplicate
    linkType: 'all',      // all | internal | external | utm | faq
    search: '',
    searchScope: 'all',   // all | url | anchor | title
    terms: [],
    sort: 'id-asc',
    selected: new Set(),
    collapsed: new Set(),
    rowLimit: FX_ROW_WINDOW,
    isLoading: false,
    isChecking: false,
    cancelCheck: false,
    checkAgain: false,
    page: 1,
    perPage: 50,
    totalPages: 1,
    totalPosts: 0,
    postCount: 0,
    home: '',
    adminUrl: '',
    postTypes: [],
    availableTypes: [],
    draftTypes: new Set(),
    status: 'publish',
    order: 'id_asc',
    find: '',
    loaded: false,
};

const nextFixerSignal = latestOnly();
const fx$ = id => document.getElementById(id);

const FX_ICON = {
    refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    pencil: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    chevron: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    wp: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    link: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    search: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    alert: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

/* ── storage (per-viewer preferences only) ── */
function fxLsGet(key, fallback) {
    try { const v = localStorage.getItem('md_fx_' + key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function fxLsSet(key, value) {
    try { localStorage.setItem('md_fx_' + key, value); } catch (e) { /* private mode */ }
}

/* ── small helpers ── */
function fxTypeLabel(type) {
    return FX_TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_]/g, ' ') : 'Unknown');
}
function fxTypeClass(type) {
    return Object.prototype.hasOwnProperty.call(FX_TYPE_LABELS, type) ? `fx-type-${type}` : 'fx-type-other';
}
function fxKey(link) {
    // The same href can live in post_content and in an FAQ field on one post.
    return `${link.post_id}||${link.href}||${link.source}||${link.meta_key || ''}`;
}
function fxTimeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const fxPct = (n, total) => (total > 0 ? (n / total) * 100 : 0);
const fxNormalizeUrl = v => String(v || '').replace(/\s+/g, ''); // URLs pasted from wrapped lines arrive with newlines
const fxIsSafeHref = url => /^(https?:\/\/|\/)/i.test(String(url || '').trim());
const fxHost = url => { try { return new URL(url).host.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } };

/** Escape + wrap every search-term hit in <mark>. */
function fxHl(text, terms) {
    const s = String(text ?? '');
    if (!terms || !terms.length) return escapeHtml(s);
    const ls = s.toLowerCase();
    let out = '', pos = 0;
    while (pos < s.length) {
        let at = -1, len = 0;
        for (const t of terms) {
            const i = ls.indexOf(t, pos);
            if (i !== -1 && (at === -1 || i < at || (i === at && t.length > len))) { at = i; len = t.length; }
        }
        if (at === -1) break;
        out += escapeHtml(s.slice(pos, at)) + '<mark>' + escapeHtml(s.slice(at, at + len)) + '</mark>';
        pos = at + len;
    }
    return out + escapeHtml(s.slice(pos));
}

/** Absolute form of a URL typed into the fixer, the way the server resolves hrefs. */
function fxAbsolute(url) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    try {
        const home = new URL(fx.home);
        if (url.startsWith('//')) return home.protocol + url;
        if (url.startsWith('/')) return home.origin + url;
    } catch (e) { /* no home yet */ }
    return url;
}
function fxIsInternal(url) {
    const h = fxHost(fxAbsolute(url));
    return !h || (fx.home !== '' && h === fxHost(fx.home));
}

/* ── live status (shared LinkStatus cache, keyed by absolute URL) ── */
const fxResult = url => LinkStatus.get(url);
const fxChecking = url => !!LinkStatus.cache[url]?.checking;
const fxIsOk = c => !!c && c.status_code >= 200 && c.status_code < 300;
const fxIsRedirect = c => !!c && c.status_code >= 300 && c.status_code < 400;
const fxIsBroken = c => !!c && !fxIsOk(c) && !fxIsRedirect(c);
const fxCanFix = c => fxIsRedirect(c) && !!c.redirect_url;

/* ═══════════════════════ URL presentation ═══════════════════════ */
function fxUrlHtml(url, terms) {
    const p = splitUrlParts(url);
    return `<span class="u-scheme">${fxHl(p.scheme, terms)}</span><span class="u-host">${fxHl(p.host, terms)}</span><span class="u-path">${fxHl(p.path, terms)}</span>`;
}
function fxUrlAnchor(url, terms, cls) {
    const inner = fxUrlHtml(url, terms);
    return fxIsSafeHref(url)
        ? `<a class="${cls}" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(url)}">${inner}</a>`
        : `<span class="${cls}" title="${escapeHtml(url)} (not a clickable scheme)">${inner}</span>`;
}

/** Where does the redirect target start to differ from the source? Backed off to a separator. */
function fxDiffStart(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i++;
    if (i >= b.length || i < 8) return 0;
    const cut = b.slice(0, i);
    const back = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('?'), cut.lastIndexOf('&'), cut.lastIndexOf('='));
    return back > 8 ? back + 1 : i;
}
function fxRedirectHtml(fromUrl, toUrl) {
    const to = String(toUrl || '');
    const n = fxDiffStart(String(fromUrl || ''), to);
    if (!n) return `<span class="u-diff">${escapeHtml(to)}</span>`;
    return `<span class="u-same">${escapeHtml(to.slice(0, n))}</span><span class="u-diff">${escapeHtml(to.slice(n))}</span>`;
}
/** One-word summary of what a redirect changes. */
function fxRedirectNote(from, to) {
    if (!from || !to) return '';
    if (from.replace(/\/+$/, '') === to.replace(/\/+$/, '')) return to.endsWith('/') ? 'adds slash' : 'drops slash';
    if (from.replace(/^http:/i, 'https:') === to) return 'to https';
    const a = splitUrlParts(from).host, b = splitUrlParts(to).host;
    if (a.replace(/^www\./i, '').toLowerCase() !== b.replace(/^www\./i, '').toLowerCase()) return 'new host';
    if (a !== b) return 'www change';
    return '';
}

function fxStatusBadge(url) {
    if (fxChecking(url)) return '<span class="fx-badge s-pend"><span class="spinner fx-spin"></span> Checking</span>';
    const c = fxResult(url);
    if (!c) return '<span class="fx-badge s-pend">Unchecked</span>';
    const code = c.status_code;
    if (c.bucket === 'blocked') return '<span class="fx-badge s-4xx" title="This URL isn\'t allowed to be checked (private/internal address)">Blocked</span>';
    if (code === 0) return '<span class="fx-badge s-4xx" title="No response — timeout, DNS failure or refused connection">Timeout</span>';
    if (fxIsOk(c)) return `<span class="fx-badge s-200" title="HTTP ${code} — reachable">${code} OK</span>`;
    if (fxIsRedirect(c)) return `<span class="fx-badge s-3xx" title="HTTP ${code} — redirects to another URL">${code}</span>`;
    return `<span class="fx-badge s-4xx" title="HTTP ${code} — broken or unavailable">${code}</span>`;
}

/* ═══════════════════════ Loading ═══════════════════════ */
function fixerParams() {
    return {
        post_type: fx.postTypes.join(','),
        status: fx.status,
        order: fx.order,
        link: fx.find,
        page: fx.page,
        per_page: fx.perPage,
    };
}

async function loadFixer() {
    if (!fx.postTypes.length) { viewNeedsLoad.fixer = true; return; } // filter options not in yet - load on next show
    fx.isLoading = true;
    fxSetTableLoading();
    const signal = nextFixerSignal();
    let ok = false;

    try {
        const json = await api('fixer_list.php', { params: fixerParams(), signal });
        if (!json.success) {
            toast(json.msg || 'Could not load posts', 'err');
            fxSetTableEmpty('Could not load posts.', json.msg || '');
            return;
        }
        fx.totalPages = json.total_pages;
        fx.totalPosts = json.total_posts;
        fx.page = json.page;
        fx.links = json.links;
        fx.home = json.home;
        fx.adminUrl = json.admin_url;
        fx.selected.clear();
        fx.collapsed.clear();
        fx.rowLimit = FX_ROW_WINDOW;
        fx.loaded = true;

        const siteLink = fx$('fx-site-url');
        siteLink.textContent = fx.home.replace(/^https?:\/\//, '');
        siteLink.href = fx.home || '#';

        fxBuildGroups();
        fxUpdateStats();
        fxRenderTable();
        fxRenderPagination();
        fxUpdateScanMeta();
        ok = true;
    } catch (err) {
        if (isAbort(err)) return;
        console.error(err);
        toast('Failed to load posts — check the console/network tab', 'err');
        fxSetTableEmpty('Failed to reach the API.', err.message);
    } finally {
        if (!signal.aborted) fx.isLoading = false;
    }

    if (ok && fx$('fx-autocheck').checked) {
        if (fx.isChecking) fx.checkAgain = true;
        else fxCheckAll({ recheckIfDone: false });
    }
}

function fxUpdateScanMeta() {
    const scope = fx.find
        ? `<span class="fx-find-chip" title="Only posts whose content or FAQ fields contain this">contains “${escapeHtml(truncate(fx.find, 40))}”</span>`
        : '';
    fx$('fx-scan-meta').innerHTML = `${scope}Page <strong>${fmtNum(fx.page)}</strong> of <strong>${fmtNum(fx.totalPages)}</strong>
        · <strong>${fmtNum(fx.totalPosts)}</strong> ${fx.status === 'any' ? 'posts' : escapeHtml(fx.status === 'publish' ? 'published' : fx.status)}`;
}

/* ── post type picker ── */
function populateFixerPostTypes(postTypes) {
    fx.availableTypes = postTypes;
    const keys = postTypes.map(t => t.type);
    let saved = [];
    try { saved = JSON.parse(fxLsGet('types', '[]')) || []; } catch (e) { saved = []; }
    const valid = saved.filter(t => keys.includes(t));
    fx.postTypes = valid.length ? valid : FX_DEFAULT_TYPES.filter(t => keys.includes(t));
    if (!fx.postTypes.length && keys.length) fx.postTypes = [keys[0]];
    fx.draftTypes = new Set(fx.postTypes);
    fxRenderTypeOptions();
    fxUpdateTypeLabel();
}

function populateFixerStatuses(statuses) {
    fx$('fx-status').innerHTML = Object.entries(statuses).map(([k, label]) =>
        `<option value="${escapeHtml(k)}"${k === fx.status ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function fxRenderTypeOptions() {
    const box = fx$('fx-pt-options');
    if (!fx.availableTypes.length) {
        box.innerHTML = '<div class="fx-pt-empty">No content types found.</div>';
        return;
    }
    box.innerHTML = fx.availableTypes.map(t => `
        <label class="fx-pt-option">
            <input type="checkbox" class="fx-pt-checkbox" value="${escapeHtml(t.type)}" ${fx.draftTypes.has(t.type) ? 'checked' : ''}>
            <span class="fx-pt-label" title="${escapeHtml(t.type)}">${escapeHtml(fxTypeLabel(t.type))}</span>
            <span class="fx-pt-count">${fmtNum(t.count)}</span>
        </label>`).join('');
}

function fxUpdateTypeLabel() {
    const n = fx.postTypes.length;
    fx$('fx-pt-label').textContent = n === 0 ? 'Post types'
        : n === fx.availableTypes.length && n > 2 ? 'All types'
            : n <= 2 ? fx.postTypes.map(fxTypeLabel).join(', ') : `${n} types`;
    fx$('fx-pt-trigger').title = n ? 'Scanning: ' + fx.postTypes.map(fxTypeLabel).join(', ') : 'Choose content types to scan';
}

function fxTogglePanel(open = !fx$('fx-pt-select').classList.contains('open')) {
    if (open) { fx.draftTypes = new Set(fx.postTypes); fxRenderTypeOptions(); }
    fx$('fx-pt-select').classList.toggle('open', open);
    fx$('fx-pt-trigger').setAttribute('aria-expanded', String(open));
}

function fxApplyTypes() {
    if (!fx.draftTypes.size) { toast('Select at least one content type', 'err'); return; }
    fx.postTypes = [...fx.draftTypes];
    fxLsSet('types', JSON.stringify(fx.postTypes));
    fxUpdateTypeLabel();
    fxTogglePanel(false);
    fx.page = 1;
    loadFixer();
}

/** Site-wide "find links containing" - entry point from other tabs too (Links & UTM "Fix"). */
function fxSetFind(value, { allTypes = false } = {}) {
    fx.find = String(value || '').trim();
    fx$('fx-find').value = fx.find;
    fx$('fx-find-wrap').classList.toggle('has-value', !!fx.find);
    if (allTypes && fx.availableTypes.length) {
        fx.postTypes = fx.availableTypes.map(t => t.type);
        fx.status = 'any';
        fx$('fx-status').value = 'any';
        fxUpdateTypeLabel();
    }
    fx.page = 1;
    loadFixer();
}

/** "Fix in Link Fixer" from another tab: every post on the site that links to this URL. */
function openFixerFor(url) {
    fx.filter = 'all';
    fx.linkType = 'all';
    fxSyncFilterUi();
    showView('fixer', { skipLoad: true });
    fxSetFind(url, { allTypes: true });
}

/* ═══════════════════════ Grouping + filtering ═══════════════════════ */
function fxBuildGroups() {
    const map = new Map();
    fx.index = new Map();
    for (const link of fx.links) {
        fx.index.set(fxKey(link), link);
        const id = String(link.post_id);
        if (!map.has(id)) {
            map.set(id, { postId: id, title: link.post_title, type: link.post_type, status: link.post_status, permalink: link.permalink, links: [] });
        }
        map.get(id).links.push(link);
    }
    fx.groups = [...map.values()];
    fx.postCount = fx.groups.length;
}

/** A write can turn two hrefs in one field into the same href (or split them) - recount repeats. */
function fxRecountOccurrences() {
    const counts = new Map();
    const k = l => `${l.post_id}||${l.href}||${l.source}||${l.meta_key || ''}`;
    fx.links.forEach(l => counts.set(k(l), (counts.get(k(l)) || 0) + 1));
    fx.links.forEach(l => { l.occurrence_count = counts.get(k(l)); });
}

function fxHaystack(link) {
    switch (fx.searchScope) {
        case 'url': return link.url;
        case 'anchor': return link.anchor_text;
        case 'title': return link.post_title;
        default: return `${link.url} ${link.anchor_text} ${link.post_title}`;
    }
}
const fxMatchesSearch = l => !fx.terms.length || fx.terms.every(t => String(fxHaystack(l) || '').toLowerCase().includes(t));
function fxMatchesType(l) {
    switch (fx.linkType) {
        case 'internal': return !!l.is_internal;
        case 'external': return !l.is_internal;
        case 'utm': return !!l.is_utm;
        case 'faq': return l.source === 'faq';
        default: return true;
    }
}
function fxMatchesStatus(l) {
    if (fx.filter === 'all') return true;
    if (fx.filter === 'duplicate') return l.occurrence_count > 1;
    const c = fxResult(l.url);
    if (fx.filter === 'pending') return !c;
    if (fx.filter === 'ok') return fxIsOk(c);
    if (fx.filter === 'redirect') return fxIsRedirect(c);
    if (fx.filter === 'error') return fxIsBroken(c);
    return true;
}

/** Links matching the type tab + search only (not the status filter) - what "Check links" covers. */
const fxScopedLinks = () => fx.links.filter(l => fxMatchesType(l) && fxMatchesSearch(l));

function fxGroupStats(links) {
    let redirects = 0, errors = 0, pending = 0;
    for (const l of links) {
        const c = fxResult(l.url);
        if (!c) pending++;
        else if (fxCanFix(c)) redirects++;
        else if (fxIsBroken(c)) errors++;
    }
    return { redirects, errors, pending };
}

function fxFilteredGroups() {
    const out = [];
    for (const g of fx.groups) {
        const links = g.links.filter(l => fxMatchesType(l) && fxMatchesSearch(l) && fxMatchesStatus(l));
        if (links.length) out.push({ ...g, links });
    }
    const issues = g => { const s = fxGroupStats(g.links); return s.errors * 10 + s.redirects; };
    const byId = (a, b) => Number(a.postId) - Number(b.postId);
    switch (fx.sort) {
        case 'id-desc': out.sort((a, b) => byId(b, a)); break;
        case 'title-asc': out.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })); break;
        case 'issues': out.sort((a, b) => issues(b) - issues(a) || byId(a, b)); break;
        case 'links-desc': out.sort((a, b) => b.links.length - a.links.length || byId(a, b)); break;
        default: out.sort(byId);
    }
    return out;
}

/** Every link passing the filters, including rows the window hasn't rendered yet. */
const fxVisibleLinks = () => fx.view.flatMap(g => g.links);

/* ═══════════════════════ Checking ═══════════════════════ */
async function fxCheckAll({ recheckIfDone = true } = {}) {
    if (fx.isChecking || fx.isLoading) return;
    const inView = fxScopedLinks();
    let urls = [...new Set(inView.filter(l => !fxResult(l.url)).map(l => l.url))];
    if (!urls.length) {
        if (!recheckIfDone) return;
        urls = [...new Set(inView.map(l => l.url))]; // the button reads "Re-check" - so re-check
    }
    if (!urls.length) { toast('No links in this view to check'); return; }

    fx.isChecking = true;
    fx.cancelCheck = false;
    fx$('fx-scanbar').classList.add('is-checking');
    fx$('fx-btn-cancel').disabled = false;
    fxSetCheckBusy(true);
    fxUpdateProgress(0, urls.length);

    let lastPaint = 0;
    const done = await LinkStatus.checkMany(urls, {
        isCancelled: () => fx.cancelCheck,
        onProgress: (n, total) => fxUpdateProgress(n, total),
        onBatch: () => {
            // Repainting a big page after every batch is expensive - throttle; the final paint happens below.
            if (Date.now() - lastPaint > 600) { fxRefresh(); lastPaint = Date.now(); }
        },
    });

    const cancelled = fx.cancelCheck;
    fx.isChecking = false;
    fx.cancelCheck = false;
    fx$('fx-scanbar').classList.remove('is-checking');
    fxSetCheckBusy(false);
    fxRefresh();

    if (cancelled) {
        toast(`Stopped after ${pluralize(done, 'URL')}`);
    } else {
        const broken = urls.filter(u => fxIsBroken(fxResult(u))).length;
        const redirects = urls.filter(u => fxIsRedirect(fxResult(u))).length;
        const bits = [];
        if (broken) bits.push(pluralize(broken, 'broken link'));
        if (redirects) bits.push(pluralize(redirects, 'redirect'));
        toast(`Checked ${pluralize(urls.length, 'URL')}${bits.length ? ' — ' + bits.join(', ') : ' — all OK'}`, broken ? 'warn' : 'ok');
    }

    if (fx.checkAgain) {
        fx.checkAgain = false;
        fxCheckAll({ recheckIfDone: false });
    }
}

function fxSetCheckBusy(busy) {
    fx$('fx-btn-check').disabled = busy;
    if (busy) fx$('fx-check-label').textContent = 'Checking…';
    else fxUpdateCheckLabel();
}

function fxUpdateProgress(done, total) {
    const p = Math.round(fxPct(done, total));
    fx$('fx-progress-fill').style.width = p + '%';
    fx$('fx-progress-text').textContent = `Checking ${fmtNum(done)} of ${fmtNum(total)} URLs · ${p}%`;
}

async function fxCheckUrls(urls, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner fx-spin"></span>'; }
    if (urls.length === 1) await LinkStatus.checkOne(urls[0]);
    else await LinkStatus.checkMany(urls);
    fxRefresh();
}

/* ═══════════════════════ Stats ═══════════════════════ */
function fxUpdateStats() {
    let ok = 0, rd = 0, err = 0, pend = 0, internal = 0, external = 0, utm = 0, faq = 0, dupe = 0;
    for (const l of fx.links) {
        const c = fxResult(l.url);
        if (!c) pend++;
        else if (fxIsOk(c)) ok++;
        else if (fxIsRedirect(c)) rd++;
        else err++;
        l.is_internal ? internal++ : external++;
        if (l.is_utm) utm++;
        if (l.source === 'faq') faq++;
        if (l.occurrence_count > 1) dupe++;
    }
    const total = fx.links.length;
    const checked = ok + rd + err;

    fx$('fx-stat-total').textContent = fmtNum(total);
    fx$('fx-stat-total-sub').textContent = `in ${pluralize(fx.postCount, 'post')}`;
    [['ok', ok], ['rd', rd], ['err', err], ['pend', pend], ['dup', dupe]].forEach(([k, n]) => {
        fx$('fx-stat-' + k).textContent = fmtNum(n);
        fx$('fx-meter-' + k).style.width = fxPct(n, total) + '%';
    });

    // Health = share of checked links that resolve cleanly (2xx).
    const card = fx$('fx-health');
    const score = checked ? Math.round(fxPct(ok, checked)) : null;
    fx$('fx-health-score').textContent = score === null ? '—' : score + '%';
    card.classList.toggle('is-good', score !== null && score >= 90);
    card.classList.toggle('is-fair', score !== null && score >= 70 && score < 90);
    card.classList.toggle('is-poor', score !== null && score < 70);
    fx$('fx-hb-ok').style.width = fxPct(ok, total) + '%';
    fx$('fx-hb-rd').style.width = fxPct(rd, total) + '%';
    fx$('fx-hb-err').style.width = fxPct(err, total) + '%';
    fx$('fx-health-foot').innerHTML = !total ? 'No links on this page'
        : checked ? `<strong>${fmtNum(checked)}</strong> of <strong>${fmtNum(total)}</strong> checked${err ? ` · <strong>${fmtNum(err)}</strong> broken` : ''}`
            : 'Run a check to score this page';

    const typeCounts = { all: total, internal, external, utm, faq };
    document.querySelectorAll('#fx-type-tabs .fx-seg-btn').forEach(b => {
        b.querySelector('.fc').textContent = fmtNum(typeCounts[b.dataset.type] ?? 0);
    });
    fxUpdateCheckLabel();
}

function fxUpdateCheckLabel() {
    if (fx.isChecking) return;
    const pending = new Set(fxScopedLinks().filter(l => !fxResult(l.url)).map(l => l.url)).size;
    const name = { internal: 'internal', external: 'external', utm: 'UTM links', faq: 'FAQ links' }[fx.linkType] || 'links';
    fx$('fx-check-label').textContent = pending ? `Check ${name} (${fmtNum(pending)})` : `Re-check ${name}`;
}

function fxUpdateCounters(shownLinks, shownGroups) {
    const filtered = fx.filter !== 'all' || fx.linkType !== 'all' || fx.terms.length > 0;
    fx$('fx-filter-note').innerHTML = filtered
        ? `Showing <strong>${fmtNum(shownLinks)}</strong> of <strong>${fmtNum(fx.links.length)}</strong> <button type="button" class="fx-link-btn" data-fx-reset>Reset</button>`
        : '';
    fx$('fx-footer-info').innerHTML = `<strong>${fmtNum(shownGroups)}</strong> post${shownGroups === 1 ? '' : 's'} ·
        <strong>${fmtNum(shownLinks)}</strong> link${shownLinks === 1 ? '' : 's'} in view`;
    fx$('fx-search-count').textContent = fx.terms.length ? `${fmtNum(shownLinks)} match${shownLinks === 1 ? '' : 'es'}` : '';
    fx$('fx-searchbox').classList.toggle('has-value', !!fx.search);
}

/* ═══════════════════════ Rendering ═══════════════════════ */
/** Stats + table after check results changed (from this tab or any other). */
function fxRefresh() {
    if (!fx.loaded) return;
    fxUpdateStats();
    fxRenderTable();
}

function fxRenderTable() {
    const wrap = fx$('fx-table-wrap');
    const tbody = fx$('fx-tbody');
    const scrollTop = wrap.scrollTop;
    const groups = fxFilteredGroups();
    fx.view = groups;
    const shownLinks = groups.reduce((n, g) => n + g.links.length, 0);

    if (!groups.length) {
        tbody.innerHTML = `<tr><td colspan="5">${fxEmptyStateHtml()}</td></tr>`;
        fxAfterRender(0, 0);
        return;
    }

    const terms = fx.terms;
    const parts = [];
    let rows = 0, truncated = false;

    for (const g of groups) {
        if (rows >= fx.rowLimit) { truncated = true; break; } // stop between groups only - never half a post
        const collapsed = fx.collapsed.has(g.postId);
        const { redirects, errors, pending } = fxGroupStats(g.links);
        const allSel = g.links.every(l => fx.selected.has(fxKey(l)));

        const meta = [`<span>${pluralize(g.links.length, 'link')}</span>`];
        if (redirects) meta.push(`<span class="fx-pill fx-pill-rd">${pluralize(redirects, 'redirect')}</span>`);
        if (errors) meta.push(`<span class="fx-pill fx-pill-err">${fmtNum(errors)} broken</span>`);
        if (g.status && g.status !== 'publish') meta.push(statusBadge(g.status));

        const editUrl = fx.adminUrl ? `${fx.adminUrl}post.php?post=${encodeURIComponent(g.postId)}&action=edit` : '';
        const id = escapeHtml(g.postId);

        parts.push(`<tr class="fx-group-row${collapsed ? ' is-collapsed' : ''}" data-post-id="${id}">
          <td colspan="5"><div class="fx-group-inner">
            <button type="button" class="fx-group-toggle" data-act="toggle" data-post-id="${id}" title="${collapsed ? 'Expand' : 'Collapse'} this post" aria-label="Toggle post group" aria-expanded="${!collapsed}">${FX_ICON.chevron}</button>
            <span class="fx-type ${fxTypeClass(g.type)}">${escapeHtml(fxTypeLabel(g.type))}</span>
            ${g.permalink
                ? `<a class="fx-group-title" href="${escapeHtml(g.permalink)}" target="_blank" rel="noopener" title="${escapeHtml(g.title)} — open on the site">${fxHl(g.title, terms)}</a>`
                : `<span class="fx-group-title">${fxHl(g.title, terms)}</span>`}
            <span class="fx-group-id">#${id}</span>
            <span class="fx-group-meta">${meta.join('')}</span>
            <span class="fx-group-actions">
              ${pending ? `<button type="button" class="btn small" data-act="checkgroup" data-post-id="${id}" title="Check the ${fmtNum(pending)} unchecked link(s) in this post">Check ${fmtNum(pending)}</button>` : ''}
              ${redirects ? `<button type="button" class="btn small warn" data-act="fixgroup" data-post-id="${id}" title="Replace every redirecting URL in this post with its target">Fix ${fmtNum(redirects)}</button>` : ''}
              ${editUrl ? `<a class="fx-icon-btn" href="${escapeHtml(editUrl)}" target="_blank" rel="noopener" title="Open in the WordPress editor">${FX_ICON.wp}</a>` : ''}
              <label class="fx-group-all" title="Select every link shown for this post"><input type="checkbox" class="fx-group-check" data-post-id="${id}" ${allSel ? 'checked' : ''}> <span>All</span></label>
            </span>
          </div></td>
        </tr>`);

        if (collapsed) continue;
        for (const link of g.links) {
            const key = fxKey(link);
            const sel = fx.selected.has(key);
            parts.push(`<tr class="fx-link-row${sel ? ' selected' : ''}${fxRowClass(link.url)}" data-key="${escapeHtml(key)}">${fxRowInner(link, key, sel)}</tr>`);
            rows++;
        }
    }

    if (truncated) {
        const remaining = shownLinks - rows;
        parts.push(`<tr class="fx-more-row"><td colspan="5">
            <button type="button" class="btn small" data-act="more">Show ${fmtNum(Math.min(remaining, FX_ROW_WINDOW))} more</button>
            <span>&nbsp;· ${fmtNum(remaining)} links not shown yet</span></td></tr>`);
    }

    tbody.innerHTML = parts.join('');
    wrap.scrollTop = scrollTop;
    fxAfterRender(shownLinks, groups.length);
}

function fxAfterRender(shownLinks, shownGroups) {
    fxObserveMoreRow();
    fxUpdateCounters(shownLinks, shownGroups);
    fxUpdateBulkBar();
    fxSyncSelectAll();
    fxUpdateToggleAllLabel();
    fxWriteHash();
}

const fxMoreObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) fxShowMore(); }, { rootMargin: '400px 0px' })
    : null;
function fxObserveMoreRow() {
    if (!fxMoreObserver) return;
    fxMoreObserver.disconnect();
    const row = fx$('fx-tbody').querySelector('.fx-more-row');
    if (row) fxMoreObserver.observe(row);
}
function fxShowMore() { fx.rowLimit += FX_ROW_WINDOW; fxRenderTable(); }
function fxResetWindow() { fx.rowLimit = FX_ROW_WINDOW; fx$('fx-table-wrap').scrollTop = 0; }

function fxRowClass(url) {
    const c = fxResult(url);
    if (!c) return '';
    return fxIsOk(c) ? ' row-ok' : fxIsRedirect(c) ? ' row-redirect' : ' row-error';
}

function fxEmptyStateHtml() {
    if (!fx.links.length) {
        return `<div class="fx-empty"><div class="fx-empty-icon">${FX_ICON.link}</div>
            <p>${fx.find ? `No links containing “${escapeHtml(fx.find)}” on this page` : 'No links found on this page of posts'}</p>
            <div class="sub">${fx.find ? 'Try another page, more content types, or status “Any status”.' : 'Try another page, a larger page size, or more content types.'}</div>
            ${fx.find ? '<button type="button" class="btn small" data-fx-clear-find>Clear find</button>' : ''}</div>`;
    }
    const msg = fx.filter === 'error' ? 'No broken links here — nice.'
        : fx.filter === 'redirect' ? 'No redirects in this view.'
            : 'No links match the current filters';
    return `<div class="fx-empty"><div class="fx-empty-icon">${FX_ICON.search}</div>
        <p>${msg}</p>
        <div class="sub">${fx.terms.length ? `Search: “${escapeHtml(fx.search)}”` : 'Adjust the status or link-type filter.'}</div>
        <button type="button" class="btn small" data-fx-reset>Reset filters</button></div>`;
}

function fxRowInner(link, key, sel) {
    const terms = fx.terms;
    const c = fxResult(link.url);
    const k = escapeHtml(key);

    const tags = [];
    if (link.source === 'faq') tags.push(`<span class="fx-badge s-faq" title="Inside an FAQ answer field (${escapeHtml(link.meta_key || '')}), not the post body">FAQ</span>`);
    if (link.occurrence_count > 1) tags.push(`<span class="fx-badge s-chk" title="This exact link appears ${link.occurrence_count} times in this ${link.source === 'faq' ? 'FAQ field' : 'post'} — editing or unlinking changes all of them">×${link.occurrence_count}</span>`);
    if (link.is_utm) tags.push('<span class="fx-badge s-utm" title="Has utm_ tracking parameters">UTM</span>');
    if (fx.linkType === 'all' && !link.is_internal) tags.push('<span class="fx-badge s-ext" title="Points to another domain">EXT</span>');
    if (link.href !== link.url && !/^https?:\/\//i.test(link.href)) tags.push(`<span class="fx-badge s-ext" title="Stored as a relative link: ${escapeHtml(link.href)}">REL</span>`);

    let redir = '';
    if (fxCanFix(c)) {
        const note = fxRedirectNote(link.url, c.redirect_url);
        const diff = fxRedirectHtml(link.url, c.redirect_url);
        const target = fxIsSafeHref(c.redirect_url)
            ? `<a class="fx-redir-url" href="${escapeHtml(c.redirect_url)}" target="_blank" rel="noopener" title="Redirect target — ${escapeHtml(c.redirect_url)}">${diff}</a>`
            : `<span class="fx-redir-url" title="Redirect target — ${escapeHtml(c.redirect_url)}">${diff}</span>`;
        redir = `<div class="fx-redir-line"><span class="fx-redir-arrow" title="Redirect target">→</span>
            <div class="fx-redir-main">${target}<button type="button" class="fx-icon-btn" data-act="copy" data-url="${escapeHtml(c.redirect_url)}" title="Copy the redirect target">${FX_ICON.copy}</button>${note ? `<span class="fx-redir-note">${escapeHtml(note)}</span>` : ''}</div></div>`;
    }

    const anchor = (link.anchor_text || '').trim();
    return `
      <td class="fx-cell-check"><input type="checkbox" class="fx-row-check" data-key="${k}" ${sel ? 'checked' : ''} aria-label="Select link"></td>
      <td class="fx-hide-mob"><div class="fx-anchor${anchor && anchor !== '(no text)' ? '' : ' is-empty'}" title="${escapeHtml(anchor)}">${fxHl(anchor || '(no text)', terms)}</div></td>
      <td>
        <div class="fx-url-cell">${fxUrlAnchor(link.url, terms, 'fx-url')}<button type="button" class="fx-icon-btn" data-act="copy" data-url="${escapeHtml(link.url)}" title="Copy this URL">${FX_ICON.copy}</button>${tags.length ? `<span class="fx-url-tags">${tags.join('')}</span>` : ''}</div>
        ${redir}
      </td>
      <td>${fxStatusBadge(link.url)}</td>
      <td><div class="fx-row-actions">
        ${fxCanFix(c) ? `<button type="button" class="btn small warn" data-act="fix" data-key="${k}" title="Replace this URL with its redirect target">Fix</button>` : ''}
        ${!c
            ? `<button type="button" class="btn small" data-act="check" data-url="${escapeHtml(link.url)}" title="Check this URL now">Check</button>`
            : `<button type="button" class="fx-icon-btn" data-act="check" data-url="${escapeHtml(link.url)}" title="Re-check this URL (checked ${escapeHtml(fxTimeAgo(c.t || Date.now()))})">${FX_ICON.refresh}</button>`}
        <button type="button" class="fx-icon-btn" data-act="edit" data-key="${k}" title="Edit or unlink this link">${FX_ICON.pencil}</button>
      </div></td>`;
}

/* ── collapse / expand ── */
function fxToggleGroup(postId) {
    fx.collapsed.has(postId) ? fx.collapsed.delete(postId) : fx.collapsed.add(postId);
    fxRenderTable();
}
function fxToggleAllGroups() {
    const anyOpen = fx.view.some(g => !fx.collapsed.has(g.postId));
    fx.view.forEach(g => (anyOpen ? fx.collapsed.add(g.postId) : fx.collapsed.delete(g.postId)));
    fxRenderTable();
}
function fxUpdateToggleAllLabel() {
    fx$('fx-btn-toggle-all').textContent = fx.view.some(g => !fx.collapsed.has(g.postId)) ? 'Collapse all' : 'Expand all';
}

/* ═══════════════════════ Writes ═══════════════════════ */
const fxPostLabel = l => `#${l.post_id} · ${truncate(l.post_title || '', 70)}${l.source === 'faq' ? ` · FAQ (${l.meta_key})` : ''}`;

/** One entry per distinct field+href - duplicate rows of the same link are a single write. */
function fxUniqueByKey(pairs) {
    const seen = new Set();
    return pairs.filter(([l]) => { const k = fxKey(l); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Send replace/unlink writes in chunks and sync local state from the results.
 * pairs: [[link, newUrl]] (newUrl ignored for unlink). Returns the number done.
 */
async function fxWrite(op, pairs, btn = null) {
    pairs = fxUniqueByKey(pairs);
    const idle = btn ? btn.innerHTML : '';
    let done = 0, failed = [];

    for (let i = 0; i < pairs.length; i += FX_WRITE_CHUNK) {
        const part = pairs.slice(i, i + FX_WRITE_CHUNK);
        if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner fx-spin"></span> ${fmtNum(i)}/${fmtNum(pairs.length)}`; }
        const items = part.map(([l, to]) => ({ post_id: l.post_id, href: l.href, source: l.source, meta_key: l.meta_key, new_url: op === 'replace' ? to : undefined }));
        let json;
        try {
            json = await api('fixer_write.php', { method: 'POST', body: new URLSearchParams({ op, items: JSON.stringify(items) }) });
        } catch (err) {
            console.error(err);
            json = { success: false, msg: 'Network error' };
        }
        if (!json.success) {
            failed.push(...part.map(([l]) => `${fxPostLabel(l)}: ${json.msg || 'failed'}`));
            continue;
        }
        json.results.forEach((r, j) => {
            const [l, to] = part[j];
            if (r.status === 'updated') { fxApplyReplace(l, to, r.new_href); done++; }
            else if (r.status === 'removed') { fxApplyUnlink(l); done++; }
            else failed.push(`${fxPostLabel(l)}: ${r.message || r.status}`);
        });
    }

    if (btn) { btn.disabled = false; btn.innerHTML = idle; }
    if (done) {
        fxRecountOccurrences();
        fxBuildGroups();
        fxRefresh();
        onLinksChanged();
        refreshHistoryCount();
    }

    const verb = op === 'unlink' ? 'Unlinked' : 'Updated';
    if (failed.length) {
        alertDialog(`${verb} ${fmtNum(done)} of ${pluralize(pairs.length, 'link')}`, 'These were not changed:', failed);
    } else {
        toast(`${verb} ${pluralize(done, 'link')}`, 'ok');
    }

    // New targets: check them right away so a "fixed" link that still redirects shows up.
    if (op === 'replace' && done) {
        const recheck = [...new Set(pairs.map(([, to]) => fxAbsolute(to)))].filter(u => !fxResult(u) || fxIsRedirect(fxResult(u)));
        if (recheck.length) LinkStatus.checkMany(recheck).then(fxRefresh);
    }
    return done;
}

/** Every row of this exact field+href now points at the new URL. */
function fxApplyReplace(link, newUrl, newHref) {
    const key = fxKey(link);
    const abs = fxAbsolute(newUrl);
    fx.links.forEach(l => {
        if (fxKey(l) !== key) return;
        l.href = newHref || newUrl;
        l.url = abs;
        l.is_internal = fxIsInternal(abs);
        l.is_utm = /[?&]utm_/i.test(abs);
    });
    fx.selected.delete(key);
}
function fxApplyUnlink(link) {
    const key = fxKey(link);
    fx.links = fx.links.filter(l => fxKey(l) !== key);
    fx.selected.delete(key);
}

async function fxFixSingle(key) {
    const link = fx.index.get(key);
    const c = link && fxResult(link.url);
    if (!fxCanFix(c)) { toast('No redirect target found — check the link first', 'err'); return; }
    const ok = await confirmDialog({
        title: 'Fix redirect',
        message: 'Replace this URL with the target it redirects to?',
        changes: [{ post: fxPostLabel(link), from: link.url, to: c.redirect_url }],
        okLabel: 'Replace URL', tone: 'warn',
    });
    if (ok) await fxWrite('replace', [[link, c.redirect_url]]);
}

async function fxFixGroup(postId) {
    const g = fx.groups.find(x => x.postId === String(postId));
    if (!g) return;
    const links = g.links.filter(l => fxCanFix(fxResult(l.url)));
    if (!links.length) { toast('No redirecting links in this post', 'err'); return; }
    const ok = await confirmDialog({
        title: `Fix ${pluralize(links.length, 'redirect')}`,
        message: `Each URL in “${g.title}” is replaced with the target it redirects to.`,
        changes: links.map(l => ({ post: fxPostLabel(l), from: l.url, to: fxResult(l.url).redirect_url })),
        okLabel: `Fix ${pluralize(links.length, 'link')}`, tone: 'warn',
    });
    if (ok) await fxWrite('replace', links.map(l => [l, fxResult(l.url).redirect_url]));
}

/* ── selection + bulk bar ── */
const fxSelectedLinks = () => [...fx.selected].map(k => fx.index.get(k)).filter(Boolean);

function fxSyncSelectAll() {
    const all = fxVisibleLinks();
    const n = all.filter(l => fx.selected.has(fxKey(l))).length;
    const box = fx$('fx-select-all');
    box.checked = all.length > 0 && n === all.length;
    box.indeterminate = n > 0 && n < all.length;
}

function fxUpdateBulkBar() {
    const n = fx.selected.size;
    const visible = n > 0 && activeView === 'fixer';
    fx$('fx-bulk-bar').classList.toggle('show', visible);
    document.body.classList.toggle('fx-has-bulk', visible);
    if (!n) return;
    fx$('fx-bulk-count').innerHTML = `<span class="fx-bulk-pill">${fmtNum(n)}</span> selected`;
    const redir = fxSelectedLinks().filter(l => fxCanFix(fxResult(l.url))).length;
    const btn = fx$('fx-bulk-redir');
    btn.textContent = redir ? `Fix ${pluralize(redir, 'redirect')}` : 'Fix redirects';
    btn.disabled = redir === 0;
    btn.title = redir ? 'Replace each selected redirecting URL with its target' : 'None of the selected links redirect (run a check first)';
}

function fxClearSelection() { fx.selected.clear(); fxRenderTable(); }

async function fxBulkFixRedirects() {
    const links = fxSelectedLinks().filter(l => fxCanFix(fxResult(l.url)));
    if (!links.length) { toast('No redirecting links in the selection (run a check first)', 'err'); return; }
    const ok = await confirmDialog({
        title: `Fix ${pluralize(links.length, 'redirect')}`,
        message: 'Each selected URL is replaced with the target it redirects to.',
        changes: links.map(l => ({ post: fxPostLabel(l), from: l.url, to: fxResult(l.url).redirect_url })),
        okLabel: `Fix ${pluralize(links.length, 'link')}`, tone: 'warn',
    });
    if (ok) await fxWrite('replace', links.map(l => [l, fxResult(l.url).redirect_url]), fx$('fx-bulk-redir'));
}

/** Replace: the whole URL with one new URL, or (part mode) find -> replace inside each URL. */
async function fxBulkReplace() {
    const links = fxSelectedLinks();
    if (!links.length) { toast('Select links first', 'err'); return; }
    const partMode = fx$('fx-bulk-mode').value === 'part';
    let pairs;

    if (partMode) {
        const find = fx$('fx-bulk-find').value;
        const repl = fx$('fx-bulk-new').value.trim();
        if (!find) { toast('Type the text to find in each URL', 'err'); fx$('fx-bulk-find').focus(); return; }
        pairs = links.filter(l => l.url.includes(find)).map(l => [l, l.url.split(find).join(repl)]);
        const skipped = links.length - pairs.length;
        if (!pairs.length) { toast(`None of the selected URLs contain “${find}”`, 'err'); return; }
        const bad = pairs.filter(([, to]) => !/^(https?:\/\/|\/)/i.test(to));
        if (bad.length) { toast(`${pluralize(bad.length, 'result')} would not start with https:// or / — adjust the replacement`, 'err'); return; }
        if (skipped) toast(`${pluralize(skipped, 'selected link')} without “${find}” will be left alone`, 'warn');
    } else {
        const newUrl = fxNormalizeUrl(fx$('fx-bulk-new').value);
        if (!newUrl) { toast('Type the replacement URL first', 'err'); fx$('fx-bulk-new').focus(); return; }
        if (!/^(https?:\/\/|\/)/i.test(newUrl)) { toast('The replacement URL should start with https:// or /', 'err'); return; }
        pairs = links.map(l => [l, newUrl]);
    }
    pairs = pairs.filter(([l, to]) => to !== l.url && to !== l.href);
    if (!pairs.length) { toast('Nothing would change'); return; }

    const ok = await confirmDialog({
        title: `Replace ${pluralize(pairs.length, 'link')}`,
        message: partMode ? `“${fx$('fx-bulk-find').value}” is replaced with “${fx$('fx-bulk-new').value.trim()}” in each URL.` : 'Every selected URL is replaced with the same new URL.',
        changes: pairs.map(([l, to]) => ({ post: fxPostLabel(l), from: l.url, to })),
        okLabel: `Replace ${pluralize(pairs.length, 'link')}`, tone: 'ok',
    });
    if (!ok) return;
    if (await fxWrite('replace', pairs, fx$('fx-bulk-replace'))) {
        fx$('fx-bulk-new').value = '';
        fx$('fx-bulk-find').value = '';
    }
}

async function fxBulkUnlink() {
    const links = fxSelectedLinks();
    if (!links.length) { toast('Select links first', 'err'); return; }
    const ok = await confirmDialog({
        title: `Unlink ${pluralize(links.length, 'link')}`,
        message: 'The <a> tags are removed. The anchor text (and its formatting) stays in the post as plain text.',
        changes: links.map(l => ({ post: fxPostLabel(l), from: l.url, to: '' })),
        okLabel: `Unlink ${pluralize(links.length, 'link')}`, tone: 'danger',
    });
    if (ok) await fxWrite('unlink', links.map(l => [l, '']), fx$('fx-bulk-remove'));
}

function fxSyncBulkMode() {
    const part = fx$('fx-bulk-mode').value === 'part';
    fx$('fx-bulk-find').hidden = !part;
    fx$('fx-bulk-new').placeholder = part ? 'Replace with…' : 'New URL for all selected…';
    fxLsSet('bulkMode', fx$('fx-bulk-mode').value);
}

/* ═══════════════════════ Pagination ═══════════════════════ */
function fxRenderPagination() {
    const total = fx.totalPages;
    const cur = Math.min(Math.max(1, fx.page), total);
    fx$('fx-page').value = cur;
    fx$('fx-page').max = total;
    fx$('fx-page-total').textContent = `/ ${fmtNum(total)}`;
    const nav = fx$('fx-pagination');
    if (total <= 1) { nav.innerHTML = ''; return; }

    const btn = (label, page, o = {}) => `<button type="button" class="fx-page-btn${o.active ? ' active' : ''}" data-page="${page}" ${o.disabled ? 'disabled' : ''} ${o.active ? 'aria-current="page"' : ''} ${o.title ? `title="${o.title}"` : ''}>${label}</button>`;
    let html = btn('‹', cur - 1, { disabled: cur === 1, title: 'Previous page (←)' });
    const s = Math.max(1, cur - 2), e = Math.min(total, cur + 2);
    if (s > 1) { html += btn('1', 1); if (s > 2) html += '<span class="fx-page-gap">…</span>'; }
    for (let p = s; p <= e; p++) html += btn(String(p), p, { active: p === cur });
    if (e < total) { if (e < total - 1) html += '<span class="fx-page-gap">…</span>'; html += btn(String(total), total); }
    html += btn('›', cur + 1, { disabled: cur === total, title: 'Next page (→)' });
    nav.innerHTML = html;
}

function fxChangePage(p) {
    p = Math.min(Math.max(1, p), fx.totalPages || p);
    if (p === fx.page && fx.loaded) { fx$('fx-page').value = p; return; }
    fx.page = p;
    fx$('fx-table-wrap').scrollTop = 0;
    loadFixer();
}

/* ═══════════════════════ Edit modal ═══════════════════════ */
let fxModalLink = null;

function fxOpenEdit(key) {
    fxModalLink = fx.index.get(key);
    const link = fxModalLink;
    if (!link) { toast('Link not found — reload posts', 'err'); return; }
    const c = fxResult(link.url);

    fx$('fx-modal-old').value = link.url;
    fx$('fx-modal-new').value = '';
    fx$('fx-modal-unlink').checked = false;
    const open = fx$('fx-modal-open-old');
    open.href = fxIsSafeHref(link.url) ? link.url : '#';
    open.hidden = !fxIsSafeHref(link.url);
    fx$('fx-modal-sub').textContent = `post #${link.post_id}`;

    fx$('fx-modal-meta').innerHTML = [
        `<span class="fx-type ${fxTypeClass(link.post_type)}">${escapeHtml(fxTypeLabel(link.post_type))}</span>`,
        `<span class="fx-badge s-ext" title="${escapeHtml(link.post_title || '')}">${escapeHtml(truncate(link.post_title || '', 50))}</span>`,
        link.source === 'faq'
            ? `<span class="fx-badge s-faq" title="Stored in postmeta key ${escapeHtml(link.meta_key || '')}">FAQ · ${escapeHtml(link.meta_key || '')}</span>`
            : '<span class="fx-badge s-ext">Post content</span>',
        link.occurrence_count > 1 ? `<span class="fx-badge s-chk">×${link.occurrence_count} in this ${link.source === 'faq' ? 'field' : 'post'}</span>` : '',
        link.href !== link.url ? `<span class="fx-badge s-ext" title="Exactly as stored in the database">stored as ${escapeHtml(truncate(link.href, 60))}</span>` : '',
        fxStatusBadge(link.url),
    ].filter(Boolean).join('');
    fx$('fx-modal-anchor').innerHTML = `Anchor text: <strong>${escapeHtml((link.anchor_text || '').trim() || '(no text)')}</strong>`;

    const target = fxCanFix(c) ? c.redirect_url : '';
    fx$('fx-modal-use-redirect').hidden = !target;
    fx$('fx-modal-use-redirect').dataset.url = target;

    fxUpdateModalMode();
    fx$('fx-edit-modal').classList.add('open');
    setTimeout(() => fx$('fx-modal-new').focus(), 60);
}
const fxCloseEdit = () => fx$('fx-edit-modal').classList.remove('open');
const fxEditOpen = () => fx$('fx-edit-modal').classList.contains('open');

function fxUpdateModalMode() {
    const removing = fx$('fx-modal-unlink').checked;
    const input = fx$('fx-modal-new');
    input.disabled = removing;
    input.closest('.fx-modal-field').classList.toggle('is-disabled', removing);
    const btn = fx$('fx-modal-save');
    btn.textContent = removing ? 'Unlink' : 'Save';
    btn.className = `btn ${removing ? 'danger' : 'primary'}`;
    fxUpdateModalHint();
}

function fxUpdateModalHint() {
    const hint = fx$('fx-modal-hint');
    const set = (cls, text) => { hint.className = 'fx-modal-hint' + (cls ? ' ' + cls : ''); hint.textContent = text; };
    if (fx$('fx-modal-unlink').checked) return set('warn', 'The <a> tag will be removed — the anchor text and its formatting stay in place.');
    const v = fxNormalizeUrl(fx$('fx-modal-new').value);
    if (!v) {
        return set('', fxModalLink?.occurrence_count > 1
            ? `This link appears ${fxModalLink.occurrence_count}× here — all occurrences are updated together.`
            : 'Paste or type the full URL, including https:// (or a site path starting with /).');
    }
    if (v === fx$('fx-modal-old').value.trim()) return set('warn', 'Same as the current URL — nothing would change.');
    if (!/^(https?:\/\/|\/)/i.test(v)) return set('bad', 'URLs must start with https:// or / — this one would be refused.');
    set('good', fxIsInternal(v) ? '✓ Internal link on this site.' : '✓ External link — points to another domain.');
}

async function fxSaveModal() {
    const link = fxModalLink;
    if (!link) return;
    const removing = fx$('fx-modal-unlink').checked;
    const newUrl = fxNormalizeUrl(fx$('fx-modal-new').value);
    if (!removing) {
        if (!newUrl) { toast('Enter the new URL', 'err'); fx$('fx-modal-new').focus(); return; }
        if (newUrl === link.url || newUrl === link.href) { toast('New URL is the same as the current one'); return; }
        if (!/^(https?:\/\/|\/)/i.test(newUrl)) { toast('URLs must start with https:// or /', 'err'); return; }
    }
    const ok = await confirmDialog(removing
        ? { title: 'Unlink this link?', message: 'The <a> tag is removed; the anchor text stays as plain text.', changes: [{ post: fxPostLabel(link), from: link.url, to: '' }], okLabel: 'Unlink', tone: 'danger' }
        : { title: 'Update this link?', changes: [{ post: fxPostLabel(link), from: link.url, to: newUrl }], okLabel: 'Save' });
    if (!ok) return;
    const btn = fx$('fx-modal-save');
    if (await fxWrite(removing ? 'unlink' : 'replace', [[link, newUrl]], btn)) fxCloseEdit();
    fxUpdateModalMode();
}

/* ═══════════════════════ Export / copy ═══════════════════════ */
/** A cell starting = + - @ runs as a formula in Excel - anchors and titles come from post content. */
const fxCsvCell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
};
function fxDownloadCsv(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(fxCsvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        download: `${name}-${SITE}-${stamp}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${pluralize(rows.length - 1, 'row')}`, 'ok');
}

function fxExportView() {
    if (!fx.view.length) { toast('Nothing to export in this view', 'err'); return; }
    const rows = [['Post ID', 'Post Type', 'Post Title', 'Post Status', 'Source', 'Link Type', 'UTM', 'Anchor Text', 'URL', 'Stored href', 'Status', 'Redirect Target', 'Occurrences']];
    fx.view.forEach(g => g.links.forEach(l => {
        const c = fxResult(l.url);
        rows.push([g.postId, fxTypeLabel(g.type), g.title, g.status, l.source === 'faq' ? `FAQ (${l.meta_key || ''})` : 'Post content',
            l.is_internal ? 'Internal' : 'External', l.is_utm ? 'yes' : '', l.anchor_text, l.url, l.href,
            c ? (c.bucket === 'blocked' ? 'blocked' : c.status_code) : 'unchecked', c?.redirect_url || '', l.occurrence_count || 1]);
    }));
    fxDownloadCsv('link-fixer', rows);
}

async function fxCopyVisible() {
    const urls = [...new Set(fxVisibleLinks().map(l => l.url))];
    if (!urls.length) { toast('No URLs in this view', 'err'); return; }
    const ok = await copyToClipboard(urls.join('\n'));
    toast(ok ? `Copied ${pluralize(urls.length, 'URL')}` : 'Copy failed — clipboard blocked', ok ? 'ok' : 'err');
}

/* ═══════════════════════ Filters + view controls ═══════════════════════ */
function fxSyncFilterUi() {
    document.querySelectorAll('#fx-stats .fx-stat').forEach(c => c.classList.toggle('active', c.dataset.filter === fx.filter));
    document.querySelectorAll('#fx-type-tabs .fx-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === fx.linkType));
}
function fxSetFilter(f) {
    fx.filter = f;
    fxSyncFilterUi();
    fxResetWindow();
    fxRenderTable();
}
function fxSetLinkType(t) {
    fx.linkType = t;
    fxSyncFilterUi();
    fxResetWindow();
    fxRenderTable();
    fxUpdateCheckLabel();
}
function fxResetFilters() {
    fx.search = '';
    fx.terms = [];
    fx$('fx-search').value = '';
    fx.filter = 'all';
    fx.linkType = 'all';
    fxSyncFilterUi();
    fxResetWindow();
    fxRenderTable();
    fxUpdateCheckLabel();
}
function fxApplySearch(value) {
    fx.search = value;
    fx.terms = value.toLowerCase().split(/\s+/).filter(Boolean);
    fxResetWindow();
    fxRenderTable();
    fxUpdateCheckLabel();
}
function fxSetDensity(compact) {
    document.body.classList.toggle('fx-compact', compact);
    document.querySelector('#fx-menu [data-menu="compact"]').setAttribute('aria-checked', String(compact));
    fxLsSet('density', compact ? 'compact' : 'comfortable');
}
function fxToggleMenu(open = !fx$('fx-menu').classList.contains('open')) {
    fx$('fx-menu').classList.toggle('open', open);
    fx$('fx-btn-menu').setAttribute('aria-expanded', String(open));
    if (open) fx$('fx-menu').querySelector('.fx-menu-item')?.focus();
}

/* Page + filters live in the hash (#fixer?page=2&status=error…), so a refresh or a shared link lands on the same view. */
function fxWriteHash() {
    if (activeView !== 'fixer') return;
    const p = new URLSearchParams();
    if (fx.page > 1) p.set('page', fx.page);
    if (fx.filter !== 'all') p.set('status', fx.filter);
    if (fx.linkType !== 'all') p.set('type', fx.linkType);
    if (fx.search) p.set('q', fx.search);
    if (fx.find) p.set('find', fx.find);
    const h = '#fixer' + (p.toString() ? '?' + p : '');
    if (location.hash !== h) history.replaceState(null, '', h);
}
function fxReadHash(query) {
    const p = new URLSearchParams(query || '');
    const page = parseInt(p.get('page'), 10);
    if (page > 0) fx.page = page;
    if (['ok', 'redirect', 'error', 'pending', 'duplicate'].includes(p.get('status'))) fx.filter = p.get('status');
    if (['internal', 'external', 'utm', 'faq'].includes(p.get('type'))) fx.linkType = p.get('type');
    if (p.get('q')) {
        fx$('fx-search').value = fx.search = p.get('q');
        fx.terms = fx.search.toLowerCase().split(/\s+/).filter(Boolean);
    }
    if (p.get('find')) {
        fx$('fx-find').value = fx.find = p.get('find');
        fx$('fx-find-wrap').classList.add('has-value');
    }
    fxSyncFilterUi();
}

/** Keyboard shortcuts while this tab is on screen. Returns true when the key was handled. */
function fxHandleKey(e) {
    if (e.key === 'Escape') {
        if (fxEditOpen()) { fxCloseEdit(); return true; }
        if (fx$('fx-menu').classList.contains('open')) { fxToggleMenu(false); fx$('fx-btn-menu').focus(); return true; }
        if (fx$('fx-pt-select').classList.contains('open')) { fxTogglePanel(false); return true; }
        if (document.activeElement === fx$('fx-search') && fx.search) { fx$('fx-search').value = ''; fxApplySearch(''); fx$('fx-search').blur(); return true; }
        if (fx.selected.size) { fxClearSelection(); return true; }
        return false;
    }
    if (fxEditOpen()) return false;
    switch (e.key.toLowerCase()) {
        case 'c': fxCheckAll(); return true;
        case 'r': loadFixer(); return true;
        case 'e': fxToggleAllGroups(); return true;
        case 'd': fxSetDensity(!document.body.classList.contains('fx-compact')); return true;
        case 'f': fx$('fx-find').focus(); fx$('fx-find').select(); return true;
        case 'arrowleft': if (fx.page > 1) fxChangePage(fx.page - 1); return true;
        case 'arrowright': if (fx.page < fx.totalPages) fxChangePage(fx.page + 1); return true;
        case '1': fxSetFilter('all'); return true;
        case '2': fxSetFilter('ok'); return true;
        case '3': fxSetFilter('redirect'); return true;
        case '4': fxSetFilter('error'); return true;
        case '5': fxSetFilter('pending'); return true;
        case '6': fxSetFilter('duplicate'); return true;
    }
    return false;
}

/* ═══════════════════════ Misc ═══════════════════════ */
function fxSetTableLoading() {
    const widths = [[62, 88], [48, 72], [70, 94], [40, 66], [56, 80], [66, 90], [44, 70], [58, 84]];
    fx$('fx-tbody').innerHTML = widths.map(([a, u]) => `<tr class="fx-skel-row">
        <td><span class="fx-skel" style="width:14px;height:14px;border-radius:4px"></span></td>
        <td class="fx-hide-mob"><span class="fx-skel" style="width:${a}%"></span></td>
        <td><span class="fx-skel" style="width:${u}%"></span></td>
        <td><span class="fx-skel" style="width:56px"></span></td>
        <td><span class="fx-skel" style="width:72px"></span></td></tr>`).join('');
}
function fxSetTableEmpty(msg, sub) {
    fx$('fx-tbody').innerHTML = `<tr><td colspan="5"><div class="fx-empty is-error"><div class="fx-empty-icon">${FX_ICON.alert}</div>
        <p>${escapeHtml(msg)}</p>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
        <button type="button" class="btn small" data-act="retry">Try again</button></div></td></tr>`;
}

/* ═══════════════════════ Binding ═══════════════════════ */
function bindFixerTab() {
    // Preferences
    const perPage = fxLsGet('perPage', '50');
    if ([...fx$('fx-perpage').options].some(o => o.value === perPage)) fx$('fx-perpage').value = perPage;
    fx.perPage = parseInt(fx$('fx-perpage').value, 10);
    fx$('fx-autocheck').checked = fxLsGet('autoCheck', '1') === '1';
    fxSetDensity(fxLsGet('density', 'comfortable') === 'compact');
    const sort = fxLsGet('sort', 'id-asc');
    if ([...fx$('fx-sort').options].some(o => o.value === sort)) fx$('fx-sort').value = fx.sort = sort;
    const scope = fxLsGet('scope', 'all');
    if ([...fx$('fx-search-scope').options].some(o => o.value === scope)) fx$('fx-search-scope').value = fx.searchScope = scope;
    const order = fxLsGet('order', 'id_asc');
    if ([...fx$('fx-order').options].some(o => o.value === order)) fx$('fx-order').value = fx.order = order;
    fx$('fx-bulk-mode').value = fxLsGet('bulkMode', 'whole') === 'part' ? 'part' : 'whole';
    fxSyncBulkMode();

    // Post type picker
    fx$('fx-pt-trigger').addEventListener('click', e => { e.stopPropagation(); fxTogglePanel(); });
    fx$('fx-pt-all').addEventListener('click', () => { fx.draftTypes = new Set(fx.availableTypes.map(t => t.type)); fxRenderTypeOptions(); });
    fx$('fx-pt-none').addEventListener('click', () => { fx.draftTypes = new Set(); fxRenderTypeOptions(); });
    fx$('fx-pt-apply').addEventListener('click', fxApplyTypes);
    fx$('fx-pt-options').addEventListener('change', e => {
        if (!e.target.classList.contains('fx-pt-checkbox')) return;
        e.target.checked ? fx.draftTypes.add(e.target.value) : fx.draftTypes.delete(e.target.value);
    });
    document.addEventListener('click', e => {
        if (fx$('fx-pt-select').classList.contains('open') && !fx$('fx-pt-select').contains(e.target)) fxTogglePanel(false);
        if (fx$('fx-menu').classList.contains('open') && !fx$('fx-menu').contains(e.target)) fxToggleMenu(false);
    });

    // Scan bar
    fx$('fx-status').addEventListener('change', e => { fx.status = e.target.value; fx.page = 1; loadFixer(); });
    fx$('fx-order').addEventListener('change', e => { fx.order = e.target.value; fxLsSet('order', fx.order); fx.page = 1; loadFixer(); });
    fx$('fx-find').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); fxSetFind(fx$('fx-find').value); }
        if (e.key === 'Escape' && fx.find) { e.stopPropagation(); fxSetFind(''); }
    });
    fx$('fx-find').addEventListener('input', e => fx$('fx-find-wrap').classList.toggle('has-value', !!e.target.value));
    fx$('fx-find-go').addEventListener('click', () => fxSetFind(fx$('fx-find').value));
    fx$('fx-find-clear').addEventListener('click', () => fxSetFind(''));
    fx$('fx-btn-load').addEventListener('click', () => loadFixer());
    fx$('fx-btn-check').addEventListener('click', () => fxCheckAll());
    fx$('fx-btn-cancel').addEventListener('click', () => { fx.cancelCheck = true; fx$('fx-btn-cancel').disabled = true; });
    fx$('fx-autocheck').addEventListener('change', e => {
        fxLsSet('autoCheck', e.target.checked ? '1' : '0');
        toast(e.target.checked ? 'New links will be checked automatically after each load' : 'Auto-check off', '', 2400);
        if (e.target.checked) fxCheckAll({ recheckIfDone: false });
    });

    // Search (client-side, within the loaded page)
    fx$('fx-search').addEventListener('input', debounce(e => fxApplySearch(e.target.value), 140));
    fx$('fx-search-clear').addEventListener('click', () => { fx$('fx-search').value = ''; fxApplySearch(''); fx$('fx-search').focus(); });
    fx$('fx-search-scope').addEventListener('change', e => {
        fx.searchScope = e.target.value;
        fxLsSet('scope', e.target.value);
        fxResetWindow();
        fxRenderTable();
        fxUpdateCheckLabel();
    });

    // Status cards: clicking the active card again goes back to "all"
    fx$('fx-stats').addEventListener('click', e => {
        const card = e.target.closest('.fx-stat');
        if (card) fxSetFilter(card.dataset.filter === fx.filter && fx.filter !== 'all' ? 'all' : card.dataset.filter);
    });
    fx$('fx-type-tabs').addEventListener('click', e => {
        const seg = e.target.closest('.fx-seg-btn');
        if (seg) fxSetLinkType(seg.dataset.type);
    });
    fx$('fixerView').addEventListener('click', e => {
        if (e.target.closest('[data-fx-reset]')) fxResetFilters();
        if (e.target.closest('[data-fx-clear-find]')) fxSetFind('');
    });

    fx$('fx-sort').addEventListener('change', e => { fx.sort = e.target.value; fxLsSet('sort', fx.sort); fxResetWindow(); fxRenderTable(); });
    fx$('fx-btn-toggle-all').addEventListener('click', fxToggleAllGroups);

    // ⋯ menu
    fx$('fx-btn-menu').addEventListener('click', e => { e.stopPropagation(); fxToggleMenu(); });
    fx$('fx-menu').querySelector('.fx-menu-panel').addEventListener('click', e => {
        const item = e.target.closest('[data-menu]');
        if (!item) return;
        fxToggleMenu(false);
        switch (item.dataset.menu) {
            case 'compact': fxSetDensity(!document.body.classList.contains('fx-compact')); break;
            case 'copy': fxCopyVisible(); break;
            case 'csv': fxExportView(); break;
            case 'clear':
                if (fx.isChecking) { toast('Stop the running check first', 'err'); break; }
                LinkStatus.clear();
                toast('Check results cleared', '', 2400);
                break;
        }
    });

    // Bulk bar
    fx$('fx-bulk-redir').addEventListener('click', fxBulkFixRedirects);
    fx$('fx-bulk-remove').addEventListener('click', fxBulkUnlink);
    fx$('fx-bulk-replace').addEventListener('click', fxBulkReplace);
    fx$('fx-bulk-clear').addEventListener('click', fxClearSelection);
    fx$('fx-bulk-mode').addEventListener('change', fxSyncBulkMode);
    ['fx-bulk-new', 'fx-bulk-find'].forEach(id => fx$(id).addEventListener('keydown', e => { if (e.key === 'Enter') fxBulkReplace(); }));

    // Table: one delegated click handler for every row action
    const tbody = fx$('fx-tbody');
    tbody.addEventListener('click', async e => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const key = el.dataset.key;
        switch (el.dataset.act) {
            case 'copy': {
                const ok = await copyToClipboard(el.dataset.url || '');
                if (!ok) { toast('Copy failed — clipboard blocked', 'err'); return; }
                el.classList.add('copied');
                el.innerHTML = FX_ICON.check;
                setTimeout(() => { el.classList.remove('copied'); el.innerHTML = FX_ICON.copy; }, 1100);
                return;
            }
            case 'check': fxCheckUrls([el.dataset.url], el); return;
            case 'checkgroup': {
                const g = fx.view.find(x => x.postId === el.dataset.postId);
                if (g) fxCheckUrls([...new Set(g.links.filter(l => !fxResult(l.url)).map(l => l.url))], el);
                return;
            }
            case 'fix': fxFixSingle(key); return;
            case 'fixgroup': fxFixGroup(el.dataset.postId); return;
            case 'edit': fxOpenEdit(key); return;
            case 'toggle': fxToggleGroup(el.dataset.postId); return;
            case 'more': fxShowMore(); return;
            case 'retry': loadFixer(); return;
        }
    });
    tbody.addEventListener('change', e => {
        const t = e.target;
        if (t.classList.contains('fx-row-check')) {
            t.checked ? fx.selected.add(t.dataset.key) : fx.selected.delete(t.dataset.key);
            // Duplicate rows share a key - keep every copy's checkbox in step.
            tbody.querySelectorAll(`.fx-link-row[data-key="${CSS.escape(t.dataset.key)}"]`).forEach(tr => {
                tr.classList.toggle('selected', t.checked);
                tr.querySelector('.fx-row-check').checked = t.checked;
            });
            fxUpdateBulkBar();
            fxSyncSelectAll();
        } else if (t.classList.contains('fx-group-check')) {
            const g = fx.view.find(x => x.postId === t.dataset.postId);
            if (g) g.links.forEach(l => (t.checked ? fx.selected.add(fxKey(l)) : fx.selected.delete(fxKey(l))));
            fxRenderTable();
        }
    });
    fx$('fx-select-all').addEventListener('change', e => {
        fxVisibleLinks().forEach(l => (e.target.checked ? fx.selected.add(fxKey(l)) : fx.selected.delete(fxKey(l))));
        fxRenderTable();
    });

    // Pagination
    fx$('fx-pagination').addEventListener('click', e => {
        const b = e.target.closest('.fx-page-btn');
        if (b && !b.disabled) fxChangePage(parseInt(b.dataset.page, 10));
    });
    fx$('fx-page').addEventListener('change', () => fxChangePage(parseInt(fx$('fx-page').value, 10) || 1));
    fx$('fx-page').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fxChangePage(parseInt(fx$('fx-page').value, 10) || 1); } });
    fx$('fx-perpage').addEventListener('change', () => {
        fx.perPage = parseInt(fx$('fx-perpage').value, 10);
        fxLsSet('perPage', fx$('fx-perpage').value);
        fx.page = 1;
        loadFixer();
    });

    // Edit modal
    fx$('fx-modal-close').addEventListener('click', fxCloseEdit);
    fx$('fx-modal-cancel').addEventListener('click', fxCloseEdit);
    fx$('fx-modal-save').addEventListener('click', fxSaveModal);
    fx$('fx-modal-unlink').addEventListener('change', fxUpdateModalMode);
    fx$('fx-modal-new').addEventListener('input', fxUpdateModalHint);
    fx$('fx-modal-new').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fxSaveModal(); } });
    fx$('fx-modal-copy-old').addEventListener('click', async () => {
        const ok = await copyToClipboard(fx$('fx-modal-old').value);
        toast(ok ? 'Current URL copied' : 'Copy failed', ok ? 'ok' : 'err', 1800);
    });
    fx$('fx-modal-start-current').addEventListener('click', () => { fx$('fx-modal-new').value = fx$('fx-modal-old').value; fx$('fx-modal-new').focus(); fxUpdateModalHint(); });
    fx$('fx-modal-use-redirect').addEventListener('click', e => { fx$('fx-modal-new').value = e.currentTarget.dataset.url || ''; fx$('fx-modal-new').focus(); fxUpdateModalHint(); });
    fx$('fx-edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) fxCloseEdit(); });

    // A check from any tab (or this one's single checks) changes rows, stats and the status filter.
    let pending = null;
    LinkStatus.onChange(() => {
        if (activeView !== 'fixer' || fx.isChecking) return;
        clearTimeout(pending);
        pending = setTimeout(fxRefresh, 60);
    });
}
