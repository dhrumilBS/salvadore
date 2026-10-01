/* ══════════════════════════════════════════════════════════
   Link & UTM Checker — frontend
   No jQuery/DataTables: plain fetch + manual render, matching
   ../healthray-sql/datewise's vanilla-JS pattern.
   ══════════════════════════════════════════════════════════ */

const state = {
    post_type: '',
    status: 'publish',
    q: '',
    date_from: '',
    date_to: '',
    utm: 'all',        // all | utm | clean | nolinks
    domain: '',
    linkStatus: '',     // '' | unchecked | ok | redirect | broken | error
    sort: 'post_date',  // post_date | title | link_count | utm_count | id
    dir: 'DESC',
    page: 1,
    per_page: 50,
};

let allRows = [];       // every post returned by list_posts.php for the current server-side filters
let filteredRows = [];  // allRows after client-side utm/domain/linkStatus filtering + sort
let debounceTimer = null;

/* ── Live link-status cache, keyed by URL so the same link found in
   multiple posts shares one check result. ── */
const linkStatusCache = {}; // url -> {checking} | {error} | {status_code,bucket,redirect_url}

/* ---------- small utils ---------- */
function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) usp.set(k, v);
    });
    return usp.toString();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) {
    return (...args) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fn(...args), ms);
    };
}

function toast(msg, kind = '') {
    const box = document.getElementById('toast');
    const el = document.createElement('div');
    el.className = 'toast-item' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall through */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch (e) {
        return false;
    }
}

function bindCopyButtons(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
        const btn = e.target.closest('.btn-copy');
        if (!btn) return;
        const ok = await copyToClipboard(btn.dataset.copy || '');
        if (ok) {
            btn.classList.add('copied');
            toast('Copied to clipboard', 'ok');
            setTimeout(() => btn.classList.remove('copied'), 1200);
        } else {
            toast('Copy failed', 'err');
        }
    });
}

function splitUrlParts(url) {
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(String(url || ''));
    if (!m) return { scheme: '', host: '', path: String(url || '') };
    return { scheme: m[1], host: m[2], path: m[3] };
}

function urlCellHtml(href) {
    const shown = String(href || '');
    if (!shown) return `<span class="url-empty">—</span>`;
    const p = splitUrlParts(shown);
    const inner = p.host
        ? `<span class="u-scheme">${escapeHtml(p.scheme)}</span><span class="u-host">${escapeHtml(p.host)}</span><span class="u-path">${escapeHtml(p.path)}</span>`
        : `<span class="u-path">${escapeHtml(shown)}</span>`;
    return `<div class="url-cell">
        <a class="url-full" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapeHtml(href)}">${inner}</a>
        <button type="button" class="btn-icon btn-copy" data-copy="${escapeHtml(href)}" title="Copy URL" aria-label="Copy URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button></div>`;
}

/* ---------- theme ---------- */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('iconMoon').style.display = theme === 'light' ? 'none' : 'block';
    document.getElementById('iconSun').style.display = theme === 'light' ? 'block' : 'none';
}

(function initTheme() {
    const stored = localStorage.getItem('lc_theme');
    const preferred = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(preferred);
})();

/* ---------- site (DB) switcher ---------- */
function cookieDir() {
    return location.pathname.replace(/[^/]*$/, '') || '/';
}

async function loadDatabaseSwitcher() {
    try {
        const res = await fetch('api/databases.php');
        const json = await res.json();
        if (!json.success) throw new Error(json.msg);
        const sel = document.getElementById('dbSelector');
        sel.innerHTML = json.databases.map(d => `<option value="${escapeHtml(d.key)}">${escapeHtml(d.label)}</option>`).join('');
        sel.value = json.current;
    } catch (err) {
        console.error(err);
        toast('Failed to load site list', 'err');
    }
}

function bindDatabaseSwitcher() {
    document.getElementById('dbSelector').addEventListener('change', e => {
        document.cookie = `lc_db=${encodeURIComponent(e.target.value)}; path=${cookieDir()}; max-age=31536000`;
        linkStatusCache && Object.keys(linkStatusCache).forEach(k => delete linkStatusCache[k]); // stale across sites
        loadFilterOptions();
        loadPosts();
    });
}

/* ---------- filter options (post types / statuses) ---------- */
async function loadFilterOptions() {
    try {
        const res = await fetch('api/filter_options.php');
        const json = await res.json();
        if (!json.success) throw new Error(json.msg);

        const ptSel = document.getElementById('fPostType');
        const currentPt = state.post_type;
        ptSel.innerHTML = '<option value="">All Types</option>' +
            json.post_types.map(t => `<option value="${escapeHtml(t.type)}">${escapeHtml(t.type)} (${t.count})</option>`).join('');
        ptSel.value = json.post_types.some(t => t.type === currentPt) ? currentPt : '';

        const stSel = document.getElementById('fStatus');
        const currentStatus = state.status;
        stSel.innerHTML = Object.entries(json.statuses).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
        stSel.value = currentStatus;
    } catch (err) {
        console.error(err);
        toast('Failed to load filter options', 'err');
    }
}

/* ---------- load posts ---------- */
function showLoading(on) {
    document.getElementById('loadingOverlay').classList.toggle('show', on);
}

function loadPosts() {
    showLoading(true);
    const params = qs({
        post_type: state.post_type,
        status: state.status,
        q: state.q,
        date_from: state.date_from,
        date_to: state.date_to,
    });

    fetch('api/list_posts.php?' + params)
        .then(r => r.json())
        .then(json => {
            showLoading(false);
            if (!json.success) throw new Error(json.msg);

            allRows = json.data;
            state.page = 1;

            document.getElementById('stTotal').textContent = json.total.toLocaleString();

            const banner = document.getElementById('capBanner');
            if (json.capped) {
                banner.style.display = 'flex';
                banner.textContent = `Showing the newest ${json.returned.toLocaleString()} of ${json.total.toLocaleString()} matching posts — narrow the filters (search, date range, status) to see the rest.`;
            } else {
                banner.style.display = 'none';
            }

            populateDomainFilter();
            applyFiltersAndRender();
        })
        .catch(err => {
            showLoading(false);
            console.error(err);
            toast('Failed to load posts', 'err');
            allRows = [];
            applyFiltersAndRender();
        });
}

/* ---------- domain filter options (derived from loaded link data) ---------- */
function populateDomainFilter() {
    const domains = new Map();
    allRows.forEach(r => r.links.forEach(l => {
        if (!l.domain) return;
        domains.set(l.domain, (domains.get(l.domain) || 0) + 1);
    }));
    const sorted = [...domains.entries()].sort((a, b) => b[1] - a[1]);

    const sel = document.getElementById('fDomain');
    const current = state.domain;
    sel.innerHTML = '<option value="">All Domains</option>' +
        sorted.map(([d, c]) => `<option value="${escapeHtml(d)}">${escapeHtml(d)} (${c})</option>`).join('');
    sel.value = sorted.some(([d]) => d === current) ? current : '';
    if (sel.value !== current) state.domain = sel.value;
}

/* ---------- client-side filter / sort / paginate ---------- */
function linkStatusBucket(url) {
    const s = linkStatusCache[url];
    if (!s) return 'unchecked';
    if (s.checking) return 'checking';
    if (s.error) return 'error';
    return s.bucket || 'unchecked';
}

function rowLinksScoped(row) {
    // Links within this row that match the domain filter (used for both display + status filter).
    return state.domain ? row.links.filter(l => l.domain === state.domain) : row.links;
}

function rowPassesFilters(row) {
    const scoped = rowLinksScoped(row);

    if (state.utm === 'utm' && !scoped.some(l => l.is_utm)) return false;
    if (state.utm === 'clean' && !(scoped.length && !scoped.some(l => l.is_utm))) return false;
    if (state.utm === 'nolinks' && scoped.length) return false;
    if (state.domain && scoped.length === 0) return false;

    if (state.linkStatus) {
        const matches = scoped.some(l => linkStatusBucket(l.url) === state.linkStatus);
        if (!matches) return false;
    }
    return true;
}

function applyFiltersAndRender() {
    filteredRows = allRows.filter(rowPassesFilters);

    filteredRows.sort((a, b) => {
        let av, bv;
        switch (state.sort) {
            case 'title': av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); break;
            case 'link_count': av = a.link_count; bv = b.link_count; break;
            case 'utm_count': av = a.utm_count; bv = b.utm_count; break;
            case 'id': av = a.id; bv = b.id; break;
            default: av = a.post_date; bv = b.post_date;
        }
        if (av < bv) return state.dir === 'ASC' ? -1 : 1;
        if (av > bv) return state.dir === 'ASC' ? 1 : -1;
        return 0;
    });

    renderStats();
    renderHead();
    renderPage();
}

/* ---------- stats ---------- */
function renderStats() {
    const totalLinks = filteredRows.reduce((s, r) => s + rowLinksScoped(r).length, 0);
    const utmLinks = filteredRows.reduce((s, r) => s + rowLinksScoped(r).filter(l => l.is_utm).length, 0);
    const postsUtm = filteredRows.filter(r => rowLinksScoped(r).some(l => l.is_utm)).length;

    document.getElementById('statPosts').textContent = filteredRows.length.toLocaleString();
    document.getElementById('statLinks').textContent = totalLinks.toLocaleString();
    document.getElementById('statUtm').textContent = utmLinks.toLocaleString();
    document.getElementById('statPostsUtm').textContent = postsUtm.toLocaleString();

    let checked = 0, broken = 0;
    Object.values(linkStatusCache).forEach(s => {
        if (s.checking) return;
        checked++;
        if (s.bucket === 'broken' || s.bucket === 'error' || s.bucket === 'blocked') broken++;
    });
    document.getElementById('statChecked').textContent = checked.toLocaleString();
    document.getElementById('statBroken').textContent = broken.toLocaleString();
}

/* ---------- table head (sortable) ---------- */
const COLUMNS = [
    { key: null, label: '#' },
    { key: 'id', label: 'ID' },
    { key: null, label: 'Slug' },
    { key: 'title', label: 'Post Title' },
    { key: null, label: 'Status' },
    { key: 'post_date', label: 'Published' },
    { key: 'link_count', label: 'Links' },
];

function renderHead() {
    document.getElementById('tableHead').innerHTML = '<tr>' + COLUMNS.map(c => {
        const active = c.key && c.key === state.sort;
        const arrow = active ? (state.dir === 'ASC' ? ' ↑' : ' ↓') : '';
        return `<th${c.key ? ` data-sort="${c.key}"` : ''}${active ? ' class="sort-active"' : ''}>${c.label}${arrow}</th>`;
    }).join('') + '</tr>';
}

function bindHeadSorting() {
    document.getElementById('tableHead').addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        if (state.sort === key) {
            state.dir = state.dir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            state.sort = key;
            state.dir = key === 'title' ? 'ASC' : 'DESC';
        }
        applyFiltersAndRender();
    });
}

/* ---------- table body / pagination ---------- */
function statusBadge(status) {
    return `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
}

function linkSummaryHtml(row) {
    const scoped = rowLinksScoped(row);
    if (!scoped.length) return `<span class="no-links">No links</span>`;
    const utmCount = scoped.filter(l => l.is_utm).length;
    const badge = utmCount > 0
        ? `<span class="link-count-badge has-utm">${scoped.length} link${scoped.length !== 1 ? 's' : ''} · ${utmCount} UTM</span>`
        : `<span class="link-count-badge">${scoped.length} link${scoped.length !== 1 ? 's' : ''}</span>`;
    return `<div class="links-summary">${badge}<button type="button" class="btn small btn-view-post" data-id="${row.id}">View ↗</button></div>`;
}

function renderPage() {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / state.per_page));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.per_page;
    const pageRows = filteredRows.slice(start, start + state.per_page);

    const tbody = document.getElementById('tableBody');
    if (!pageRows.length) {
        tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}"><div class="state-msg">No posts match the current filters.</div></td></tr>`;
    } else {
        tbody.innerHTML = pageRows.map((r, i) => `
            <tr class="${rowLinksScoped(r).some(l => l.is_utm) ? 'has-utm' : ''}">
                <td class="mono" style="color:var(--text3)">${start + i + 1}</td>
                <td><span class="id-chip">${r.id}</span></td>
                <td class="mono">${escapeHtml(r.slug || '—')}</td>
                <td><a class="post-title-link" href="${escapeHtml(r.guid)}" target="_blank" rel="noopener">${escapeHtml(r.title || '(untitled)')}</a></td>
                <td>${statusBadge(r.status)}</td>
                <td class="mono">${r.post_date ? escapeHtml(r.post_date.split(' ')[0]) : '—'}</td>
                <td>${linkSummaryHtml(r)}</td>
            </tr>`).join('');
    }

    document.getElementById('stShown').textContent = filteredRows.length.toLocaleString();
    document.getElementById('pgCur').textContent = state.page;
    document.getElementById('pgTotal').textContent = totalPages;
    document.getElementById('pgRows').textContent = filteredRows.length.toLocaleString();
    document.getElementById('pgPrev').disabled = state.page <= 1;
    document.getElementById('pgNext').disabled = state.page >= totalPages;
}

/* ---------- live link-status checking ---------- */
function linkStatusBadgeHtml(url, { withCheckBtn = true } = {}) {
    const s = linkStatusCache[url];
    if (!s) {
        return withCheckBtn ? `<button type="button" class="btn-check-link" data-check-url="${escapeHtml(url)}">Check</button>` : '';
    }
    if (s.checking) return '<span class="spinner"></span>';
    if (s.error || s.bucket === 'blocked') {
        return `<span class="badge ls-${s.bucket === 'blocked' ? 'blocked' : 'error'}" title="${escapeHtml(s.error || 'Blocked')}">${s.bucket === 'blocked' ? 'blocked' : 'error'}</span>` +
            (withCheckBtn ? `<button type="button" class="btn-check-link" data-check-url="${escapeHtml(url)}" title="Retry">↻</button>` : '');
    }
    const redirectNote = s.redirect_url
        ? `<span class="ls-target" title="${escapeHtml(s.redirect_url)}">→ ${escapeHtml(s.redirect_url)}</span>`
        : '';
    return `<span class="badge ls-${s.bucket}">${s.status_code}</span>` +
        (withCheckBtn ? `<button type="button" class="btn-check-link" data-check-url="${escapeHtml(url)}" title="Recheck">↻</button>` : '') +
        redirectNote;
}

async function checkOneUrl(url) {
    linkStatusCache[url] = { checking: true };
    refreshStatusUi(url);
    try {
        const res = await fetch('api/check_url_status.php?url=' + encodeURIComponent(url));
        const json = await res.json();
        linkStatusCache[url] = json.success
            ? { status_code: json.status_code, bucket: json.bucket, redirect_url: json.redirect_url }
            : { error: json.msg || 'Check failed' };
    } catch (err) {
        console.error(err);
        linkStatusCache[url] = { error: 'Network error' };
    }
    refreshStatusUi(url);
    // Re-filter/re-render: the "Filter by live check result" dropdown depends
    // on this cache, so a single check can change which rows currently match it.
    applyFiltersAndRender();
}

async function checkManyUrls(urls, onProgress) {
    const CHUNK = 250; // server caps a single bulk call at 300
    const unique = [...new Set(urls)];
    unique.forEach(u => { linkStatusCache[u] = { checking: true }; });
    unique.forEach(refreshStatusUi);

    let done = 0;
    for (let i = 0; i < unique.length; i += CHUNK) {
        const batch = unique.slice(i, i + CHUNK);
        try {
            const fd = new FormData();
            fd.append('urls', JSON.stringify(batch));
            const res = await fetch('api/check_links_bulk.php', { method: 'POST', body: fd });
            const json = await res.json();
            if (json.success) {
                Object.entries(json.results).forEach(([url, info]) => {
                    linkStatusCache[url] = { status_code: info.status_code, bucket: info.bucket, redirect_url: info.redirect_url };
                });
            } else {
                batch.forEach(u => { linkStatusCache[u] = { error: json.msg || 'Check failed' }; });
            }
        } catch (err) {
            console.error(err);
            batch.forEach(u => { linkStatusCache[u] = { error: 'Network error' }; });
        }
        batch.forEach(refreshStatusUi);
        done += batch.length;
        if (onProgress) onProgress(done, unique.length);
    }
    applyFiltersAndRender();
}

function refreshStatusUi(url) {
    document.querySelectorAll(`[data-status-url]`).forEach(cell => {
        if (cell.dataset.statusUrl === url) {
            cell.innerHTML = linkStatusBadgeHtml(url);
        }
    });
}

function bindTableClicks() {
    document.getElementById('tableBody').addEventListener('click', e => {
        const viewBtn = e.target.closest('.btn-view-post');
        if (viewBtn) openDetailModal(parseInt(viewBtn.dataset.id, 10));
    });
}

function bindCheckAll() {
    document.getElementById('checkAllBtn').addEventListener('click', async () => {
        const btn = document.getElementById('checkAllBtn');
        const urls = [...new Set(filteredRows.flatMap(r => rowLinksScoped(r).map(l => l.url)))];
        if (!urls.length) { toast('No links to check', 'warn'); return; }
        btn.disabled = true;
        await checkManyUrls(urls, (done, total) => { btn.textContent = `Checking… (${done}/${total})`; });
        btn.disabled = false;
        btn.textContent = 'Check all links';
        toast(`Checked ${urls.length} link(s)`, 'ok');
    });
}

/* ---------- post detail modal ---------- */
let detailPostId = null;

function openDetailModal(id) {
    const row = allRows.find(r => r.id === id);
    if (!row) return;
    detailPostId = id;

    document.getElementById('detailTitle').textContent = row.title || '(untitled)';
    document.getElementById('detailMeta').innerHTML = `
        <span class="id-chip">#${row.id}</span>
        ${statusBadge(row.status)}
        <span class="mono col-note">${escapeHtml(row.post_date ? row.post_date.split(' ')[0] : '')}</span>
        <a class="btn small" href="${escapeHtml(row.guid)}" target="_blank" rel="noopener">Open post ↗</a>`;
    document.getElementById('detailLinkCount').textContent = `${row.links.length} link${row.links.length !== 1 ? 's' : ''}`;

    renderDetailCards(row);
    document.getElementById('detailModal').classList.add('open');
}

function renderDetailCards(row) {
    const box = document.getElementById('detailLinkCards');
    if (!row.links.length) {
        box.innerHTML = `<div class="empty-state">No links found in this post.</div>`;
        return;
    }
    box.innerHTML = row.links.map(l => `
        <div class="link-card ${l.is_utm ? 'utm' : ''}">
            <div class="link-card-top">
                ${urlCellHtml(l.url)}
                <div class="link-card-status" data-status-url="${escapeHtml(l.url)}">${linkStatusBadgeHtml(l.url)}</div>
            </div>
            ${l.anchor ? `<div class="link-anchor">↳ ${escapeHtml(l.anchor)}</div>` : ''}
            <div class="domain-tag">${l.is_internal ? 'Internal' : 'External'} · ${escapeHtml(l.domain || '—')}</div>
            ${l.is_utm ? `<div class="utm-params">${l.utm_params.map(p => `<span class="utm-param-tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
        </div>`).join('');
}

function bindDetailModal() {
    document.getElementById('detailClose').addEventListener('click', () => document.getElementById('detailModal').classList.remove('open'));
    document.getElementById('detailModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
    });
    document.getElementById('detailLinkCards').addEventListener('click', e => {
        const btn = e.target.closest('[data-check-url]');
        if (btn) checkOneUrl(btn.dataset.checkUrl);
    });
    document.getElementById('detailCheckAllBtn').addEventListener('click', async () => {
        const row = allRows.find(r => r.id === detailPostId);
        if (!row || !row.links.length) return;
        const btn = document.getElementById('detailCheckAllBtn');
        btn.disabled = true;
        await checkManyUrls(row.links.map(l => l.url), (done, total) => { btn.textContent = `Checking… (${done}/${total})`; });
        btn.disabled = false;
        btn.textContent = 'Check all links in this post';
    });
}

/* ---------- filters binding ---------- */
function bindFilters() {
    document.getElementById('fPostType').addEventListener('change', e => { state.post_type = e.target.value; loadPosts(); });
    document.getElementById('fStatus').addEventListener('change', e => { state.status = e.target.value; loadPosts(); });
    document.getElementById('fSearch').addEventListener('input', debounce(e => { state.q = e.target.value.trim(); loadPosts(); }, 400));

    document.getElementById('fUtmTabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        document.querySelectorAll('#fUtmTabs .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        state.utm = btn.dataset.utm;
        state.page = 1;
        applyFiltersAndRender();
    });

    document.getElementById('fDomain').addEventListener('change', e => { state.domain = e.target.value; state.page = 1; applyFiltersAndRender(); });
    document.getElementById('fLinkStatus').addEventListener('change', e => { state.linkStatus = e.target.value; state.page = 1; applyFiltersAndRender(); });

    document.getElementById('moreFiltersBtn').addEventListener('click', () => {
        document.getElementById('datesPanel').classList.toggle('open');
        document.getElementById('moreFiltersBtn').classList.toggle('is-open');
    });
    document.getElementById('fDateFrom').addEventListener('change', e => { state.date_from = e.target.value; loadPosts(); });
    document.getElementById('fDateTo').addEventListener('change', e => { state.date_to = e.target.value; loadPosts(); });
    document.getElementById('clearDatesBtn').addEventListener('click', () => {
        state.date_from = ''; state.date_to = '';
        document.getElementById('fDateFrom').value = '';
        document.getElementById('fDateTo').value = '';
        loadPosts();
    });

    document.getElementById('fPerPage').addEventListener('change', e => { state.per_page = parseInt(e.target.value, 10); state.page = 1; renderPage(); });
    document.getElementById('pgPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; renderPage(); } });
    document.getElementById('pgNext').addEventListener('click', () => { state.page++; renderPage(); });
}

/* ---------- export ---------- */
function bindExport() {
    const exportBtn = document.getElementById('exportBtn');
    const exportMenu = document.getElementById('exportMenu');
    exportBtn.addEventListener('click', e => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));
    exportMenu.addEventListener('click', e => e.stopPropagation());

    exportMenu.querySelectorAll('.export-item').forEach(item => {
        item.addEventListener('click', () => {
            const mode = item.dataset.mode;
            const checkLive = document.getElementById('exportCheckLive').checked;
            const params = qs({
                mode, post_type: state.post_type, status: state.status, q: state.q,
                date_from: state.date_from, date_to: state.date_to,
                utm_filter: state.utm, domain: state.domain,
                check: checkLive ? 1 : '',
            });
            window.location.href = 'api/export.php?' + params;
            exportMenu.classList.remove('open');
            if (checkLive) toast('Live-checked export started — this can take a while for large sites', 'warn');
        });
    });
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        localStorage.setItem('lc_theme', next);
        applyTheme(next);
    });

    bindDatabaseSwitcher();
    bindFilters();
    bindHeadSorting();
    bindTableClicks();
    bindCheckAll();
    bindDetailModal();
    bindExport();
    bindCopyButtons('detailLinkCards');

    loadDatabaseSwitcher();
    loadFilterOptions();
    loadPosts();
});
