/* ══════════════════════════ Links & UTM tab ══════════════════════════
 * Every <a href> in post content (extracted server-side by
 * api/links_list.php), UTM tracking links flagged, domain filter, and live
 * broken/redirect checking through the shared LinkStatus checker. DB-column
 * filters (type/status/search/dates) go to the server; everything derived
 * from the extracted links (UTM/domain/live status), plus sort + paging,
 * runs client-side over the already-loaded rows. */

const linksState = {
    post_type: 'any',
    status: 'publish',
    search: '',
    date_from: '',
    date_to: '',
    mod_from: '',
    mod_to: '',
    utm: 'all',        // all | utm | clean | nolinks
    domain: '',
    linkStatus: '',    // '' | unchecked | ok | redirect | broken | error
    sort: 'post_date', // post_date | title | link_count | id
    dir: 'DESC',
    page: 1,
    per_page: 50,
};

let linksAllRows = [];      // every post returned by links_list.php for the current server-side filters
let linksFilteredRows = []; // after client-side utm/domain/linkStatus filtering + sort

const LINKS_COLUMNS = [
    { key: null, label: '#' },
    { key: 'id', label: 'ID' },
    { key: null, label: 'Slug' },
    { key: 'title', label: 'Post Title' },
    { key: null, label: 'Status' },
    { key: 'post_date', label: 'Published' },
    { key: 'link_count', label: 'Links' },
];

/* ---------- load ---------- */
function populateLinksFilters(postTypes, statuses) {
    const ptSel = document.getElementById('lPostType');
    ptSel.innerHTML = '<option value="any">All Types</option>' +
        postTypes.map(t => `<option value="${escapeHtml(t.type)}">${escapeHtml(t.type)} (${t.count})</option>`).join('');
    ptSel.value = postTypes.some(t => t.type === linksState.post_type) ? linksState.post_type : 'any';

    const stSel = document.getElementById('lStatus');
    stSel.innerHTML = Object.entries(statuses).map(([k, label]) => `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`).join('');
    stSel.value = linksState.status;
}

function linksServerParams() {
    const { post_type, status, search, date_from, date_to, mod_from, mod_to } = linksState;
    return { post_type, status, search, date_from, date_to, mod_from, mod_to };
}

function loadLinks() {
    document.getElementById('lLoadingOverlay').classList.add('show');

    fetch('api/links_list.php?' + qs(linksServerParams()))
        .then(r => r.json())
        .then(json => {
            if (!json.success) throw new Error(json.msg);
            linksAllRows = json.data;
            linksState.page = 1;

            document.getElementById('lStTotal').textContent = json.total.toLocaleString();

            const banner = document.getElementById('lCapBanner');
            if (json.capped) {
                banner.style.display = 'flex';
                banner.textContent = `Showing the newest ${json.returned.toLocaleString()} of ${json.total.toLocaleString()} matching posts — narrow the filters (search, date range, status) to see the rest.`;
            } else {
                banner.style.display = 'none';
            }

            populateDomainFilter();
            applyLinksFiltersAndRender();
        })
        .catch(err => {
            console.error(err);
            toast('Failed to load posts', 'err');
            linksAllRows = [];
            applyLinksFiltersAndRender();
        })
        .finally(() => document.getElementById('lLoadingOverlay').classList.remove('show'));
}

/* ---------- domain filter options (derived from loaded link data) ---------- */
function populateDomainFilter() {
    const domains = new Map();
    linksAllRows.forEach(r => r.links.forEach(l => {
        if (!l.domain) return;
        domains.set(l.domain, (domains.get(l.domain) || 0) + 1);
    }));
    const sorted = [...domains.entries()].sort((a, b) => b[1] - a[1]);

    const sel = document.getElementById('lDomain');
    const current = linksState.domain;
    sel.innerHTML = '<option value="">All Domains</option>' +
        sorted.map(([d, c]) => `<option value="${escapeHtml(d)}">${escapeHtml(d)} (${c})</option>`).join('');
    sel.value = sorted.some(([d]) => d === current) ? current : '';
    linksState.domain = sel.value;
}

/* ---------- client-side filter / sort / paginate ---------- */
function rowLinksScoped(row) {
    // Links within this row that match the domain filter (used for both display + status filter).
    return linksState.domain ? row.links.filter(l => l.domain === linksState.domain) : row.links;
}

function rowPassesLinkFilters(row) {
    const scoped = rowLinksScoped(row);

    if (linksState.utm === 'utm' && !scoped.some(l => l.is_utm)) return false;
    if (linksState.utm === 'clean' && !(scoped.length && !scoped.some(l => l.is_utm))) return false;
    if (linksState.utm === 'nolinks' && scoped.length) return false;
    if (linksState.domain && scoped.length === 0) return false;

    if (linksState.linkStatus && !scoped.some(l => LinkStatus.bucket(l.url) === linksState.linkStatus)) return false;
    return true;
}

function applyLinksFiltersAndRender() {
    linksFilteredRows = linksAllRows.filter(rowPassesLinkFilters);

    const dir = linksState.dir === 'ASC' ? 1 : -1;
    linksFilteredRows.sort((a, b) => {
        let av, bv;
        switch (linksState.sort) {
            case 'title': av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); break;
            case 'link_count': av = a.link_count; bv = b.link_count; break;
            case 'id': av = a.id; bv = b.id; break;
            default: av = a.post_date; bv = b.post_date;
        }
        return av < bv ? -dir : av > bv ? dir : 0;
    });

    renderLinksStats();
    renderLinksHead();
    renderLinksPage();
}

function renderLinksStats() {
    const totalLinks = linksFilteredRows.reduce((s, r) => s + rowLinksScoped(r).length, 0);
    const utmLinks = linksFilteredRows.reduce((s, r) => s + rowLinksScoped(r).filter(l => l.is_utm).length, 0);
    const postsUtm = linksFilteredRows.filter(r => rowLinksScoped(r).some(l => l.is_utm)).length;

    document.getElementById('lStatPosts').textContent = linksFilteredRows.length.toLocaleString();
    document.getElementById('lStatLinks').textContent = totalLinks.toLocaleString();
    document.getElementById('lStatUtm').textContent = utmLinks.toLocaleString();
    document.getElementById('lStatPostsUtm').textContent = postsUtm.toLocaleString();

    const { checked, broken } = LinkStatus.stats();
    document.getElementById('lStatChecked').textContent = checked.toLocaleString();
    document.getElementById('lStatBroken').textContent = broken.toLocaleString();
}

function renderLinksHead() {
    document.getElementById('lTableHead').innerHTML = '<tr>' + LINKS_COLUMNS.map(c => {
        const active = c.key && c.key === linksState.sort;
        const arrow = active ? (linksState.dir === 'ASC' ? ' ↑' : ' ↓') : '';
        return `<th${c.key ? ` data-sort="${c.key}"` : ''}${active ? ' class="sort-active"' : ''}>${c.label}${arrow}</th>`;
    }).join('') + '</tr>';
}

function linkSummaryHtml(row) {
    const scoped = rowLinksScoped(row);
    if (!scoped.length) return `<span class="no-links">No links</span>`;
    const utmCount = scoped.filter(l => l.is_utm).length;
    const plural = scoped.length !== 1 ? 's' : '';
    const badge = utmCount > 0
        ? `<span class="link-count-badge has-utm">${scoped.length} link${plural} · ${utmCount} UTM</span>`
        : `<span class="link-count-badge">${scoped.length} link${plural}</span>`;
    return `<div class="links-summary">${badge}<button type="button" class="btn small btn-view-post" data-id="${row.id}">View ↗</button></div>`;
}

function renderLinksPage() {
    const totalPages = Math.max(1, Math.ceil(linksFilteredRows.length / linksState.per_page));
    if (linksState.page > totalPages) linksState.page = totalPages;
    const start = (linksState.page - 1) * linksState.per_page;
    const pageRows = linksFilteredRows.slice(start, start + linksState.per_page);

    const tbody = document.getElementById('lTableBody');
    if (!pageRows.length) {
        tbody.innerHTML = `<tr><td colspan="${LINKS_COLUMNS.length}"><div class="state-msg">No posts match the current filters.</div></td></tr>`;
    } else {
        tbody.innerHTML = pageRows.map((r, i) => `
            <tr class="${rowLinksScoped(r).some(l => l.is_utm) ? 'has-utm' : ''}">
                <td class="mono" style="color:var(--text3)">${start + i + 1}</td>
                <td><span class="id-chip">${r.id}</span></td>
                <td class="mono">${escapeHtml(r.slug || '—')}</td>
                <td><a class="post-title-link" href="${escapeHtml(r.permalink)}" target="_blank" rel="noopener">${escapeHtml(r.title || '(untitled)')}</a></td>
                <td>${statusBadge(r.status)}</td>
                <td class="mono">${r.post_date ? escapeHtml(r.post_date.split(' ')[0]) : '—'}</td>
                <td>${linkSummaryHtml(r)}</td>
            </tr>`).join('');
    }

    document.getElementById('lStShown').textContent = linksFilteredRows.length.toLocaleString();
    document.getElementById('lPgCur').textContent = linksState.page;
    document.getElementById('lPgTotal').textContent = totalPages;
    document.getElementById('lPgRows').textContent = linksFilteredRows.length.toLocaleString();
    document.getElementById('lPgPrev').disabled = linksState.page <= 1;
    document.getElementById('lPgNext').disabled = linksState.page >= totalPages;
}

/* ---------- post link-detail modal ---------- */
let detailPostId = null;

function openDetailModal(id) {
    const row = linksAllRows.find(r => r.id === id);
    if (!row) return;
    detailPostId = id;

    document.getElementById('detailTitle').textContent = row.title || '(untitled)';
    document.getElementById('detailMeta').innerHTML = `
        <span class="id-chip">#${row.id}</span>
        ${statusBadge(row.status)}
        <span class="mono col-note">${escapeHtml(row.post_date ? row.post_date.split(' ')[0] : '')}</span>
        <a class="btn small" href="${escapeHtml(row.permalink)}" target="_blank" rel="noopener">Open post ↗</a>`;
    document.getElementById('detailLinkCount').textContent = `${row.links.length} link${row.links.length !== 1 ? 's' : ''}`;

    const box = document.getElementById('detailLinkCards');
    box.innerHTML = !row.links.length
        ? `<div class="empty-state">No links found in this post.</div>`
        : row.links.map(l => `
            <div class="link-card ${l.is_utm ? 'utm' : ''}">
                <div class="link-card-top">
                    ${urlCellHtml(l.url)}
                    <div class="link-card-status" data-status-url="${escapeHtml(l.url)}">${LinkStatus.badge(l.url)}</div>
                </div>
                ${l.anchor ? `<div class="link-anchor">↳ ${escapeHtml(l.anchor)}</div>` : ''}
                <div class="domain-tag">${l.is_internal ? 'Internal' : 'External'} · ${escapeHtml(l.domain || '—')}</div>
                ${l.is_utm ? `<div class="utm-params">${l.utm_params.map(p => `<span class="utm-param-tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
            </div>`).join('');

    document.getElementById('detailModal').classList.add('open');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('open');
}

/* ---------- binding ---------- */
function bindLinksTab() {
    document.getElementById('lPostType').addEventListener('change', e => { linksState.post_type = e.target.value; loadLinks(); });
    document.getElementById('lStatus').addEventListener('change', e => { linksState.status = e.target.value; loadLinks(); });
    document.getElementById('lSearch').addEventListener('input', debounce(e => { linksState.search = e.target.value.trim(); loadLinks(); }, 400));

    document.getElementById('lUtmTabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        document.querySelectorAll('#lUtmTabs .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        linksState.utm = btn.dataset.utm;
        linksState.page = 1;
        applyLinksFiltersAndRender();
    });

    document.getElementById('lDomain').addEventListener('change', e => { linksState.domain = e.target.value; linksState.page = 1; applyLinksFiltersAndRender(); });
    document.getElementById('lLinkStatus').addEventListener('change', e => { linksState.linkStatus = e.target.value; linksState.page = 1; applyLinksFiltersAndRender(); });

    bindPanelToggle('lDatesBtn', 'lDatesPanel');
    [['lDateFrom', 'date_from'], ['lDateTo', 'date_to'], ['lModFrom', 'mod_from'], ['lModTo', 'mod_to']].forEach(([id, key]) => {
        document.getElementById(id).addEventListener('change', e => { linksState[key] = e.target.value; loadLinks(); });
    });
    document.getElementById('lClearDatesBtn').addEventListener('click', () => {
        ['date_from', 'date_to', 'mod_from', 'mod_to'].forEach(k => { linksState[k] = ''; });
        ['lDateFrom', 'lDateTo', 'lModFrom', 'lModTo'].forEach(id => { document.getElementById(id).value = ''; });
        loadLinks();
    });

    document.getElementById('lPerPage').addEventListener('change', e => { linksState.per_page = parseInt(e.target.value, 10); linksState.page = 1; renderLinksPage(); });
    document.getElementById('lPgPrev').addEventListener('click', () => { if (linksState.page > 1) { linksState.page--; renderLinksPage(); } });
    document.getElementById('lPgNext').addEventListener('click', () => { linksState.page++; renderLinksPage(); });

    document.getElementById('lTableHead').addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        if (linksState.sort === key) {
            linksState.dir = linksState.dir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            linksState.sort = key;
            linksState.dir = key === 'title' ? 'ASC' : 'DESC';
        }
        applyLinksFiltersAndRender();
    });

    document.getElementById('lTableBody').addEventListener('click', e => {
        const viewBtn = e.target.closest('.btn-view-post');
        if (viewBtn) openDetailModal(parseInt(viewBtn.dataset.id, 10));
    });

    document.getElementById('lCheckAllBtn').addEventListener('click', async e => {
        const urls = linksFilteredRows.flatMap(r => rowLinksScoped(r).map(l => l.url));
        if (!urls.length) { toast('No links to check', 'warn'); return; }
        const n = await LinkStatus.checkManyWithButton(urls, e.currentTarget);
        toast(`Checked ${n} link(s)`, 'ok');
    });

    // Modal
    document.getElementById('detailClose').addEventListener('click', closeDetailModal);
    document.getElementById('detailModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDetailModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailModal(); });
    document.getElementById('detailCheckAllBtn').addEventListener('click', e => {
        const row = linksAllRows.find(r => r.id === detailPostId);
        if (row && row.links.length) LinkStatus.checkManyWithButton(row.links.map(l => l.url), e.currentTarget);
    });

    // Export dropdown
    const exportMenu = document.getElementById('lExportMenu');
    document.getElementById('lExportBtn').addEventListener('click', e => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));
    exportMenu.addEventListener('click', e => e.stopPropagation());
    exportMenu.querySelectorAll('.export-item').forEach(item => {
        item.addEventListener('click', () => {
            const checkLive = document.getElementById('lExportCheckLive').checked;
            window.location.href = 'api/links_export.php?' + qs({
                mode: item.dataset.mode,
                ...linksServerParams(),
                utm_filter: linksState.utm,
                domain: linksState.domain,
                check: checkLive ? 1 : '',
            });
            exportMenu.classList.remove('open');
            if (checkLive) toast('Live-checked export started — this can take a while for large sites', 'warn');
        });
    });

    // A check anywhere (this tab, Content, Redirects) can change which rows the
    // "live check result" filter matches, and the Checked/Broken stat cards.
    LinkStatus.onChange(() => {
        if (!linksAllRows.length) return;
        if (linksState.linkStatus) applyLinksFiltersAndRender();
        else renderLinksStats();
    });
}
