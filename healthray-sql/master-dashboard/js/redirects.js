/* ══════════════════════════ Redirects tab ══════════════════════════
 * Yoast Premium redirects (origin -> destination, from wp_options) cross-
 * referenced against live posts, with the same live-link-check (on the
 * origin URL) and filtered-CSV-export UX as the Content tab. */

const redirectsState = {
    search: '',
    type: '',        // comma list e.g. "301,410"
    format: '',      // '', 'plain', 'regex'
    match: '',       // '', 'origin_live', 'dest_missing', 'healthy'
    sort: 'origin',
    dir: 'ASC',
    page: 1,
    per_page: 50,
    link_status: '', // export-only live-check filter on the origin URL
};

let currentRedirects = [];
const nextRedirectsSignal = latestOnly();

function redirectTypeBadgeClass(type) {
    if (type === 301 || type === 302) return 'ls-redirect';
    if (type === 410 || type === 404) return 'ls-gone';
    return 'badge-neutral';
}

function updateRedirectsExportLink() {
    const { page, per_page, ...rest } = redirectsState;
    document.getElementById('redirectsExportCsv').href = apiUrl('redirects_export.php', rest);
}

function renderRedirectsHead() {
    document.getElementById('redirectsHead').innerHTML = '<tr>' +
        [['Origin', 1], ['Type', 0], ['Destination', 1], ['Format', 0],
        ['Origin match', 0], ['Destination match', 0], ['Link status (origin)', 0]]
            .map(([h, wide]) => `<th${wide ? ' class="url-col"' : ''}>${h}</th>`).join('') + '</tr>';
}

function matchBadge(post) {
    const cls = post.status === 'publish' ? 'badge-publish' : (post.status === 'trash' ? 'badge-trash' : 'badge-neutral');
    return `<span class="badge ${cls}" title="#${post.id} · ${escapeHtml(post.post_type)} · ${escapeHtml(post.status)}">${escapeHtml(truncate(post.title, 36))}</span>`;
}

function renderRedirectRow(r) {
    // Origin/destination shown in full — these are the two values the whole
    // tab exists to compare, so neither is ever truncated.
    const originCell = r.origin_url
        ? urlCellHtml(r.origin_url, '/' + r.origin + '/')
        : urlCellHtml('', r.origin);

    const destCell = !r.url
        ? '<span class="url-empty">—</span>'
        : r.dest_url
            ? urlCellHtml(r.dest_url, '/' + r.url + '/')
            : urlCellHtml('', r.url);

    // A trashed/draft origin post is the normal state of a retired URL; only a
    // post that is still reachable conflicts with the redirect.
    const originMatch = !r.origin_post
        ? '<span class="col-note">—</span>'
        : r.origin_live
            ? `${matchBadge(r.origin_post)} <span class="warn-flag" title="Origin still resolves to a live post - this redirect may be stale or conflicting">⚠️</span>`
            : matchBadge(r.origin_post);

    const destMatch = !r.url
        ? '<span class="col-note">—</span>'
        : r.format !== 'plain'
            ? '<span class="col-note" title="Regex destination - not checked against posts">regex</span>'
            : !r.dest_post
                ? '<span class="badge ls-gone" title="Destination doesn\'t match any known post">missing</span>'
                : r.dest_live
                    ? matchBadge(r.dest_post)
                    : `${matchBadge(r.dest_post)} <span class="warn-flag" title="Destination post isn't published - visitors are sent to a page that doesn't load">⚠️</span>`;

    return `<tr>
        <td class="url-col">${originCell}</td>
        <td><span class="badge ${redirectTypeBadgeClass(r.type)}">${r.type || '—'}</span></td>
        <td class="url-col">${destCell}</td>
        <td><span class="badge badge-neutral">${escapeHtml(r.format)}</span></td>
        <td>${originMatch}</td>
        <td>${destMatch}</td>
        <td>${LinkStatus.cell(r.origin_url)}</td>
    </tr>`;
}

function showRedirectsState(msg, isError) {
    document.getElementById('redirectsBody').innerHTML =
        `<tr><td colspan="7" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
}

function loadRedirects() {
    showRedirectsState('<span class="spinner"></span> Loading…', false);
    updateRedirectsExportLink();

    const { link_status, ...listParams } = redirectsState;
    api('redirects.php', { params: listParams, signal: nextRedirectsSignal() })
        .then(json => {
            if (!json.success) {
                currentRedirects = [];
                showRedirectsState(escapeHtml(json.msg || 'Failed to load redirects'), true);
                return;
            }
            currentRedirects = json.data;
            redirectsState.page = json.page;
            document.getElementById('redirectsBody').innerHTML = currentRedirects.length
                ? currentRedirects.map(renderRedirectRow).join('')
                : '<tr><td colspan="7" class="state-msg">No redirects match the current filters/search.</td></tr>';
            document.getElementById('rStTotal').textContent = json.total;
            document.getElementById('rStTotal2').textContent = json.total;
            document.getElementById('rStPage').textContent = json.page;
            document.getElementById('rStPage2').textContent = `${json.page} of ${json.total_pages}`;
            document.getElementById('rStPages').textContent = json.total_pages;
            document.getElementById('rStShowing').textContent = currentRedirects.length;
            document.getElementById('rPgFirst').disabled = json.page <= 1;
            document.getElementById('rPgPrev').disabled = json.page <= 1;
            document.getElementById('rPgNext').disabled = json.page >= json.total_pages;
            document.getElementById('rPgLast').disabled = json.page >= json.total_pages;
        })
        .catch(err => {
            if (isAbort(err)) return;
            console.error(err);
            currentRedirects = [];
            showRedirectsState('Failed to load redirects — check the console/network tab', true);
        });
}

function goToRedirectsPage(p) {
    redirectsState.page = p;
    loadRedirects();
}

function bindRedirectsTab() {
    const reload = () => { redirectsState.page = 1; loadRedirects(); };

    document.getElementById('rSearch').addEventListener('input', debounce(() => {
        redirectsState.search = document.getElementById('rSearch').value.trim();
        reload();
    }, 350));

    document.querySelectorAll('.redirect-type-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            redirectsState.type = Array.from(document.querySelectorAll('.redirect-type-cb:checked')).map(c => c.value).join(',');
            reload();
        });
    });

    document.getElementById('rFormat').addEventListener('change', e => { redirectsState.format = e.target.value; reload(); });
    document.getElementById('rMatch').addEventListener('change', e => { redirectsState.match = e.target.value; reload(); });
    document.getElementById('rSort').addEventListener('change', e => { redirectsState.sort = e.target.value; loadRedirects(); });
    document.getElementById('rPerPage').addEventListener('change', e => { redirectsState.per_page = parseInt(e.target.value, 10); reload(); });

    document.getElementById('rDir').addEventListener('click', () => {
        redirectsState.dir = redirectsState.dir === 'DESC' ? 'ASC' : 'DESC';
        document.getElementById('rDir').textContent = redirectsState.dir === 'DESC' ? '↓ DESC' : '↑ ASC';
        loadRedirects();
    });

    bindPanelToggle('rLinkFilterBtn', 'rLinkFilterPanel');

    document.querySelectorAll('.redirect-link-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            redirectsState.link_status = Array.from(document.querySelectorAll('.redirect-link-filter-cb:checked')).map(c => c.value).join(',');
            updateRedirectsExportLink();
        });
    });

    document.getElementById('redirectsExportCsv').addEventListener('click', e => confirmSlowExport(e,
        'This export will live-check every matching redirect\'s origin URL before including it — it can take a while for large result sets.',
        !!redirectsState.link_status));

    document.getElementById('rClearFiltersBtn').addEventListener('click', () => {
        Object.assign(redirectsState, { search: '', type: '', format: '', match: '', page: 1 });
        document.getElementById('rSearch').value = '';
        document.querySelectorAll('.redirect-type-cb').forEach(cb => { cb.checked = false; });
        document.getElementById('rFormat').value = '';
        document.getElementById('rMatch').value = '';
        loadRedirects();
    });

    document.getElementById('rPgFirst').addEventListener('click', () => goToRedirectsPage(1));
    document.getElementById('rPgPrev').addEventListener('click', () => goToRedirectsPage(Math.max(1, redirectsState.page - 1)));
    document.getElementById('rPgNext').addEventListener('click', () => goToRedirectsPage(redirectsState.page + 1));
    document.getElementById('rPgLast').addEventListener('click', () => goToRedirectsPage(parseInt(document.getElementById('rStPages').textContent, 10)));

    document.getElementById('rCheckAllLinksBtn').addEventListener('click', e => {
        LinkStatus.checkManyWithButton(currentRedirects.map(r => r.origin_url), e.currentTarget, { skipChecked: true });
    });

    renderRedirectsHead();
}
