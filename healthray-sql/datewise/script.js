const ALL_COLUMNS = [
    { key: 'id', label: 'ID' },
    // Post type is shown for context but is fixed by the tab group above the
    // table, not something a per-row edit or export column controls.
    { key: 'post_type', label: 'Post Type', exportable: false },
    { key: 'title', label: 'Title' },
    { key: 'slug', label: 'Slug' },
    { key: 'permalink', label: 'Permalink' },
    { key: 'status', label: 'Status' },
    { key: 'category', label: 'Category' },
    { key: 'meta_title', label: 'Meta Title' },
    { key: 'meta_description', label: 'Meta Description' },
    { key: 'publish_date', label: 'Publish Date' },
    // Live HTTP check (301/404/410/...) - hidden by default and never exported:
    // a bulk export can match thousands of rows, and checking every URL live
    // during export would make that impractically slow.
    { key: 'link_status', label: 'Link Status', defaultVisible: false, exportable: false },
];

const state = {
    post_type: 'post',
    status: 'publish',
    date_from: '',
    date_to: '',
    mod_from: '',
    mod_to: '',
    search: '',
    sort: 'post_date',
    dir: 'DESC',
    page: 1,
    per_page: 20,
    link_status: '', // export-only live link-status filter, e.g. "200,301" - never sent to list_posts.php
};

const FIELD_LABELS = {
    title: 'Title',
    slug: 'Slug',
    status: 'Status',
    publish_date: 'Publish Date',
    meta_title: 'Meta Title',
    meta_description: 'Meta Description',
};

let currentRows = [];
let debounceTimer = null;
let visibleColumns = loadVisibleColumns();
// Edits are staged here (per post id -> field -> pending value) and only sent
// to update_post.php once the user explicitly confirms a Save - nothing is
// written to the database on change/blur alone.
let dirtyFields = {};

function loadVisibleColumns() {
    try {
        const stored = JSON.parse(localStorage.getItem('dw_columns') || 'null');
        const valid = Array.isArray(stored) ? stored.filter(k => ALL_COLUMNS.some(c => c.key === k)) : [];
        if (valid.length) return valid;
    } catch (e) { /* ignore malformed storage */ }
    return ALL_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);
}

function saveVisibleColumns() {
    localStorage.setItem('dw_columns', JSON.stringify(visibleColumns));
}

function activeColumns() {
    return ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));
}

function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) usp.set(k, v);
    });
    return usp.toString();
}

function exportParams() {
    const { page, per_page, ...rest } = state;
    const columns = activeColumns().filter(c => c.exportable !== false).map(c => c.key).join(',');
    return { ...rest, columns };
}

function updateExportLinks() {
    document.getElementById('exportCsv').href = 'api/export.php?' + qs(exportParams());
}

function renderColumnsPanel() {
    const panel = document.getElementById('columnsPanel');
    panel.innerHTML = ALL_COLUMNS.map(c => `
        <label class="col-check">
            <input type="checkbox" data-col="${c.key}"${visibleColumns.includes(c.key) ? ' checked' : ''}>
            ${c.label}${c.exportable === false ? '<span class="col-note">live check, not exported</span>' : ''}
        </label>`).join('');
    panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const key = cb.dataset.col;
            if (cb.checked) {
                if (!visibleColumns.includes(key)) visibleColumns.push(key);
            } else if (visibleColumns.length <= 1) {
                cb.checked = true; // always keep at least one column visible
                return;
            } else {
                visibleColumns = visibleColumns.filter(k => k !== key);
            }
            saveVisibleColumns();
            renderHead();
            renderTable();
            updateExportLinks();
            updateCheckAllBtnVisibility();
        });
    });
}

function renderHead() {
    document.getElementById('tableHead').innerHTML =
        '<tr>' + activeColumns().map(c => `<th>${c.label}</th>`).join('') + '<th>Actions</th></tr>';
}

const STATUS_OPTIONS = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];

function editableInput(r, field, extraClass = '') {
    return `<input type="text" class="cell-input ${extraClass}" data-id="${r.id}" data-field="${field}" value="${escapeHtml(r[field])}">`;
}

function toDatetimeLocal(d) {
    if (!d) return '';
    return d.slice(0, 16).replace(' ', 'T');
}

function renderCell(r, key) {
    switch (key) {
        case 'id':
            return `<td class="mono">${r.id}</td>`;
        case 'post_type':
            return `<td><span class="badge badge-neutral">${escapeHtml(r.post_type)}</span></td>`;
        case 'title':
            return `<td>${editableInput(r, 'title')}</td>`;
        case 'slug':
            return `<td>${editableInput(r, 'slug', 'mono')}</td>`;
        case 'permalink':
            return `<td><a class="truncate mono" href="${escapeHtml(r.permalink)}" target="_blank" rel="noopener">${escapeHtml(r.permalink)}</a></td>`;
        case 'status':
            return `<td><select class="cell-input" data-id="${r.id}" data-field="status">` +
                STATUS_OPTIONS.map(s => `<option value="${s}"${s === r.status ? ' selected' : ''}>${s}</option>`).join('') +
                '</select></td>';
        case 'category':
            return `<td><span class="truncate" title="${escapeHtml(r.category)}">${escapeHtml(r.category) || '—'}</span></td>`;
        case 'meta_title':
            return `<td>${editableInput(r, 'meta_title')}</td>`;
        case 'meta_description':
            return `<td>${editableInput(r, 'meta_description')}</td>`;
        case 'publish_date':
            return `<td><input type="datetime-local" class="cell-input mono" data-id="${r.id}" data-field="publish_date" value="${toDatetimeLocal(r.publish_date)}"></td>`;
        case 'link_status':
            return `<td data-link-status-id="${r.id}">${postLinkStatus.content(r.id)}</td>`;
        default:
            return '<td>—</td>';
    }
}

function linkStatusClass(code) {
    if (code >= 200 && code < 300) return 'ls-ok';
    if (code >= 300 && code < 400) return 'ls-redirect';
    if (code === 404 || code === 410) return 'ls-gone';
    return 'ls-error';
}

/**
 * Live HTTP status checking (single + concurrent "check all"), shared by the
 * Posts/Pages table and the Redirects table. Each caller gets its own cache
 * object so IDs from one table never shadow the other's cached result -
 * callers namespace their own id strings (e.g. redirects use "r"+id).
 */
function createLinkStatusController() {
    const cache = {};

    function content(id) {
        const s = cache[id];
        if (!s) {
            return `<button type="button" class="btn-check-link" data-check-id="${id}">Check</button>`;
        }
        if (s.checking) {
            return '<span class="spinner"></span>';
        }
        if (s.error) {
            return `<span class="badge ls-error" title="${escapeHtml(s.error)}">error</span>
                <button type="button" class="btn-check-link" data-check-id="${id}" title="Retry">↻</button>`;
        }
        const redirectNote = s.redirect_url
            ? `<span class="truncate mono" style="font-size:11px" title="${escapeHtml(s.redirect_url)}">→ ${escapeHtml(truncate(s.redirect_url, 40))}</span>`
            : '';
        return `<span class="badge ${linkStatusClass(s.status_code)}">${s.status_code}</span>
            ${redirectNote}
            <button type="button" class="btn-check-link" data-check-id="${id}" title="Recheck">↻</button>`;
    }

    function updateCell(id) {
        const cell = document.querySelector(`[data-link-status-id="${id}"]`);
        if (cell) cell.innerHTML = content(id);
    }

    async function check(id, url) {
        cache[id] = { checking: true };
        updateCell(id);
        try {
            const res = await fetch('api/check_url_status.php?url=' + encodeURIComponent(url));
            const json = await res.json();
            cache[id] = json.success
                ? { status_code: json.status_code, redirect_url: json.redirect_url }
                : { error: json.msg || 'Check failed' };
        } catch (err) {
            console.error(err);
            cache[id] = { error: 'Network error' };
        }
        updateCell(id);
    }

    async function checkAll(items, btn, idleLabel) {
        const targets = items.filter(it => it.url && (!cache[it.id] || cache[it.id].error));
        if (!targets.length) return;

        btn.disabled = true;
        let done = 0;
        const CONCURRENCY = 4;
        let next = 0;
        async function worker() {
            while (next < targets.length) {
                const it = targets[next++];
                await check(it.id, it.url);
                done++;
                btn.textContent = `Checking… (${done}/${targets.length})`;
            }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
        btn.disabled = false;
        btn.textContent = idleLabel;
    }

    return { content, check, checkAll, cache };
}

const postLinkStatus = createLinkStatusController();
const redirectLinkStatus = createLinkStatusController();

function updateCheckAllBtnVisibility() {
    document.getElementById('checkAllLinksBtn').style.display =
        visibleColumns.includes('link_status') ? '' : 'none';
}

function bindLinkStatus() {
    document.getElementById('tableBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-check-link');
        if (!btn) return;
        const id = btn.dataset.checkId;
        const row = currentRows.find(r => String(r.id) === String(id));
        if (row) postLinkStatus.check(id, row.permalink);
    });
    document.getElementById('checkAllLinksBtn').addEventListener('click', () => {
        postLinkStatus.checkAll(
            currentRows.map(r => ({ id: r.id, url: r.permalink })),
            document.getElementById('checkAllLinksBtn'),
            'Check all links (page)'
        );
    });
}

function bindCellEditing() {
    document.getElementById('tableBody').addEventListener('change', e => {
        const input = e.target.closest('.cell-input');
        if (input) markDirty(input);
    });
    document.getElementById('tableBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-save-row');
        if (btn) saveRow(btn.dataset.rowId);
    });
    document.getElementById('saveAllBtn').addEventListener('click', saveAllDirty);
}

/** Stage an edit locally - nothing is written to the database until Save is clicked and confirmed. */
function markDirty(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;

    input.classList.remove('save-error', 'saved');
    input.classList.add('dirty');

    if (!dirtyFields[id]) dirtyFields[id] = {};
    dirtyFields[id][field] = input.value;

    updateRowSaveButton(id);
    updateSaveBar();
}

/** Re-stamp pending edits (value + dirty styling, Save button state) onto freshly rendered rows. */
function applyDirtyOverlay() {
    Object.keys(dirtyFields).forEach(id => {
        const fields = dirtyFields[id];
        Object.keys(fields).forEach(field => {
            const input = document.querySelector(`.cell-input[data-id="${id}"][data-field="${field}"]`);
            if (input) {
                input.value = fields[field];
                input.classList.add('dirty');
            }
        });
        updateRowSaveButton(id);
    });
    updateSaveBar();
}

function updateRowSaveButton(id) {
    const btn = document.querySelector(`.btn-save-row[data-row-id="${id}"]`);
    if (!btn) return;
    const count = dirtyFields[id] ? Object.keys(dirtyFields[id]).length : 0;
    btn.disabled = count === 0;
    btn.textContent = count ? `Save (${count})` : 'Save';
}

function updateSaveBar() {
    const ids = Object.keys(dirtyFields).filter(id => Object.keys(dirtyFields[id]).length);
    const bar = document.getElementById('saveBar');
    if (!ids.length) {
        bar.style.display = 'none';
        return;
    }
    const totalFields = ids.reduce((n, id) => n + Object.keys(dirtyFields[id]).length, 0);
    bar.style.display = 'flex';
    document.getElementById('dirtyCount').textContent =
        `${totalFields} unsaved change${totalFields === 1 ? '' : 's'} across ${ids.length} post${ids.length === 1 ? '' : 's'}`;
}

function describeChanges(fields) {
    return Object.entries(fields)
        .map(([field, value]) => `• ${FIELD_LABELS[field] || field}: ${truncate(String(value), 60)}`)
        .join('\n');
}

function saveRow(id) {
    const fields = dirtyFields[id];
    if (!fields || !Object.keys(fields).length) return;

    const count = Object.keys(fields).length;
    const ok = confirm(`Save ${count} change${count === 1 ? '' : 's'} to post #${id}?\n\n${describeChanges(fields)}`);
    if (!ok) return;

    persistFields(id, fields);
}

async function saveAllDirty() {
    const ids = Object.keys(dirtyFields).filter(id => Object.keys(dirtyFields[id]).length);
    if (!ids.length) return;

    const totalFields = ids.reduce((n, id) => n + Object.keys(dirtyFields[id]).length, 0);
    const preview = ids.slice(0, 8)
        .map(id => `• Post #${id}: ${Object.keys(dirtyFields[id]).map(f => FIELD_LABELS[f] || f).join(', ')}`)
        .join('\n');
    const more = ids.length > 8 ? `\n…and ${ids.length - 8} more post(s)` : '';
    const ok = confirm(`Save ${totalFields} change${totalFields === 1 ? '' : 's'} across ${ids.length} post${ids.length === 1 ? '' : 's'}?\n\n${preview}${more}`);
    if (!ok) return;

    const saveAllBtn = document.getElementById('saveAllBtn');
    saveAllBtn.disabled = true;
    saveAllBtn.textContent = 'Saving…';

    const CONCURRENCY = 4;
    let next = 0;
    async function worker() {
        while (next < ids.length) {
            const id = ids[next++];
            await persistFields(id, { ...dirtyFields[id] });
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

    saveAllBtn.disabled = false;
    saveAllBtn.textContent = 'Save all changes';
}

/** Send every staged field for one post to update_post.php. Fields that fail stay dirty for retry. */
async function persistFields(id, fields) {
    const entries = Object.entries(fields);
    entries.forEach(([field]) => {
        const input = document.querySelector(`.cell-input[data-id="${id}"][data-field="${field}"]`);
        if (input) { input.disabled = true; input.classList.add('saving'); }
    });

    const results = await Promise.all(entries.map(([field, value]) =>
        fetch('api/update_post.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ id, field, value }),
        })
            .then(r => r.json())
            .catch(() => ({ success: false, msg: 'Network error - not saved' }))
            .then(json => ({ field, value, json }))
    ));

    let slugSaved = false;
    const errors = [];

    results.forEach(({ field, value, json }) => {
        const input = document.querySelector(`.cell-input[data-id="${id}"][data-field="${field}"]`);
        if (input) { input.disabled = false; input.classList.remove('saving'); }

        if (!json.success) {
            errors.push(`${FIELD_LABELS[field] || field}: ${json.msg || 'Save failed'}`);
            if (input) { input.classList.add('save-error'); input.title = json.msg || 'Save failed'; }
            return; // left in dirtyFields so it can be retried
        }

        const savedValue = json.value ?? value;
        const row = currentRows.find(r => String(r.id) === String(id));
        if (row) row[field] = savedValue;
        if (field === 'slug') slugSaved = true;

        if (input) {
            input.classList.remove('dirty');
            if (field === 'publish_date') {
                input.value = toDatetimeLocal(savedValue);
            } else if (input.tagName !== 'SELECT') {
                input.value = savedValue;
            }
            input.classList.add('saved');
            setTimeout(() => input.classList.remove('saved'), 900);
        }

        if (dirtyFields[id]) delete dirtyFields[id][field];
    });

    if (dirtyFields[id] && !Object.keys(dirtyFields[id]).length) delete dirtyFields[id];

    updateRowSaveButton(id);
    updateSaveBar();

    if (errors.length) {
        alert(`Some changes to post #${id} were not saved:\n\n${errors.join('\n')}`);
    }

    if (slugSaved) {
        loadPosts(); // permalink is derived from slug - refresh so it stays accurate; other pending edits are re-applied via applyDirtyOverlay()
    }
}

function statusBadge(status) {
    return `<span class="badge badge-${status}">${status}</span>`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) {
    s = String(s ?? '');
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmtDate(d) {
    if (!d) return '—';
    return d.slice(0, 16).replace(' ', ' · ');
}

function renderActionsCell(r) {
    return `<td class="actions-cell"><button type="button" class="btn-save-row" data-row-id="${r.id}" disabled>Save</button></td>`;
}

function renderTable() {
    const cols = activeColumns();
    const tbody = document.getElementById('tableBody');
    if (!currentRows.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="state-msg">No posts match the current filters/search.</td></tr>`;
        applyDirtyOverlay();
        return;
    }
    tbody.innerHTML = currentRows.map(r =>
        '<tr>' + cols.map(c => renderCell(r, c.key)).join('') + renderActionsCell(r) + '</tr>').join('');
    applyDirtyOverlay();
}

function showTableState(msg, isError) {
    document.getElementById('tableBody').innerHTML =
        `<tr><td colspan="${activeColumns().length + 1}" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
}

function loadPosts() {
    showTableState('<span class="spinner"></span> Loading…', false);
    updateExportLinks();

    fetch('api/list_posts.php?' + qs(state))
        .then(r => r.json())
        .then(json => {
            if (!json.success) {
                currentRows = [];
                showTableState(json.msg || 'Failed to load posts', true);
                return;
            }
            currentRows = json.data;
            renderTable();
            document.getElementById('stTotal').textContent = json.total;
            document.getElementById('stTotal2').textContent = json.total;
            document.getElementById('stPage').textContent = json.page;
            document.getElementById('stPages').textContent = json.total_pages;
            document.getElementById('stShowing').textContent = currentRows.length;
            document.getElementById('pgFirst').disabled = json.page <= 1;
            document.getElementById('pgPrev').disabled = json.page <= 1;
            document.getElementById('pgNext').disabled = json.page >= json.total_pages;
            document.getElementById('pgLast').disabled = json.page >= json.total_pages;
        })
        .catch(err => {
            console.error(err);
            currentRows = [];
            showTableState('Failed to load posts — check the console/network tab', true);
        });
}

function goToPage(p) {
    state.page = p;
    loadPosts();
}

function bindFilters() {
    document.getElementById('fSearch').addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            state.search = document.getElementById('fSearch').value.trim();
            state.page = 1;
            loadPosts();
        }, 350);
    });

    const simpleSelects = [
        ['fStatus', 'status'], ['fSort', 'sort'],
    ];
    simpleSelects.forEach(([id, key]) => {
        document.getElementById(id).addEventListener('change', e => {
            state[key] = e.target.value;
            state.page = 1;
            loadPosts();
        });
    });

    document.getElementById('fPostTypeTabs').addEventListener('click', e => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        document.querySelectorAll('#fPostTypeTabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.post_type = tab.dataset.type;
        state.page = 1;
        loadPosts();
    });

    [['fDateFrom', 'date_from'], ['fDateTo', 'date_to'], ['fModFrom', 'mod_from'], ['fModTo', 'mod_to']]
        .forEach(([id, key]) => {
            document.getElementById(id).addEventListener('change', e => {
                state[key] = e.target.value;
                state.page = 1;
                loadPosts();
            });
        });

    document.getElementById('fPerPage').addEventListener('change', e => {
        state.per_page = parseInt(e.target.value, 10);
        state.page = 1;
        loadPosts();
    });

    document.getElementById('fDir').addEventListener('click', () => {
        state.dir = state.dir === 'DESC' ? 'ASC' : 'DESC';
        document.getElementById('fDir').textContent = state.dir === 'DESC' ? '↓ DESC' : '↑ ASC';
        loadPosts();
    });

    document.getElementById('moreFiltersBtn').addEventListener('click', () => {
        document.getElementById('moreFilters').classList.toggle('open');
    });

    document.getElementById('columnsBtn').addEventListener('click', () => {
        document.getElementById('columnsPanel').classList.toggle('open');
    });

    document.getElementById('linkFilterBtn').addEventListener('click', () => {
        document.getElementById('linkFilterPanel').classList.toggle('open');
    });

    document.querySelectorAll('.link-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(document.querySelectorAll('.link-filter-cb:checked')).map(c => c.value);
            state.link_status = checked.join(',');
            updateExportLinks();
        });
    });

    document.getElementById('exportCsv').addEventListener('click', e => {
        if (!state.link_status) return;
        const ok = confirm('This export will live-check every matching post\'s URL before including it - it can take minutes for large result sets. Continue?');
        if (!ok) e.preventDefault();
    });

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
        Object.assign(state, {
            post_type: 'post', status: 'publish',
            date_from: '', date_to: '', mod_from: '', mod_to: '', search: '', page: 1,
        });
        document.querySelectorAll('#fPostTypeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.type === 'post'));
        document.getElementById('fStatus').value = 'publish';
        ['fDateFrom', 'fDateTo', 'fModFrom', 'fModTo', 'fSearch'].forEach(id => document.getElementById(id).value = '');
        loadPosts();
    });

    document.getElementById('pgFirst').addEventListener('click', () => goToPage(1));
    document.getElementById('pgPrev').addEventListener('click', () => goToPage(Math.max(1, state.page - 1)));
    document.getElementById('pgNext').addEventListener('click', () => goToPage(state.page + 1));
    document.getElementById('pgLast').addEventListener('click', () => goToPage(parseInt(document.getElementById('stPages').textContent, 10)));
}

/* ══════════════════════════ Redirects tab ══════════════════════════
 * Yoast Premium redirects (origin -> destination, from wp_options) cross-
 * referenced against live posts, with the same live-link-check and
 * filtered-CSV-export UX as the Posts/Pages table above. */

const redirectsState = {
    search: '',
    type: '',        // comma list e.g. "301,410"
    format: '',      // '', 'plain', 'regex'
    match: '',       // '', 'origin_live', 'dest_missing', 'healthy'
    sort: 'origin',
    dir: 'ASC',
    page: 1,
    per_page: 20,
    link_status: '', // export-only live-check filter on the origin URL
};

let currentRedirects = [];
let redirectsLoadedOnce = false;
let redirectsDebounceTimer = null;

function redirectTypeBadgeClass(type) {
    if (type === 301 || type === 302) return 'ls-redirect';
    if (type === 410 || type === 404) return 'ls-gone';
    return 'badge-neutral';
}

function redirectsExportParams() {
    const { page, per_page, ...rest } = redirectsState;
    return rest;
}

function updateRedirectsExportLink() {
    document.getElementById('redirectsExportCsv').href = 'api/redirects_export.php?' + qs(redirectsExportParams());
}

function renderRedirectsHead() {
    document.getElementById('redirectsHead').innerHTML = '<tr>' +
        ['Origin', 'Type', 'Destination', 'Format', 'Origin match', 'Destination match', 'Link status (origin)']
            .map(h => `<th>${h}</th>`).join('') + '</tr>';
}

function matchBadge(post) {
    const cls = post.status === 'publish' ? 'badge-publish' : (post.status === 'trash' ? 'badge-trash' : 'badge-neutral');
    return `<span class="badge ${cls}" title="#${post.id} · ${escapeHtml(post.post_type)} · ${escapeHtml(post.status)}">${escapeHtml(truncate(post.title, 36))}</span>`;
}

function renderRedirectRow(r) {
    const rid = 'r' + r.id;

    const originCell = r.origin_url
        ? `<a class="truncate mono" href="${escapeHtml(r.origin_url)}" target="_blank" rel="noopener">/${escapeHtml(r.origin)}/</a>`
        : `<span class="mono truncate" title="${escapeHtml(r.origin)}">${escapeHtml(truncate(r.origin, 60))}</span>`;

    const destCell = !r.url
        ? '<span class="col-note">—</span>'
        : r.dest_url
            ? `<a class="truncate mono" href="${escapeHtml(r.dest_url)}" target="_blank" rel="noopener">/${escapeHtml(r.url)}/</a>`
            : `<span class="mono truncate" title="${escapeHtml(r.url)}">${escapeHtml(truncate(r.url, 60))}</span>`;

    const originMatch = r.origin_post
        ? `${matchBadge(r.origin_post)} <span title="Origin still resolves to a live post - this redirect may be stale or conflicting">⚠️</span>`
        : '<span class="col-note">—</span>';

    const destMatch = !r.url
        ? '<span class="col-note">—</span>'
        : r.format !== 'plain'
            ? '<span class="col-note" title="Regex destination - not checked against posts">regex</span>'
            : r.dest_post
                ? matchBadge(r.dest_post)
                : '<span class="badge ls-gone" title="Destination doesn\'t match any known post">missing</span>';

    const linkStatusCell = r.origin_url ? redirectLinkStatus.content(rid) : '<span class="col-note">n/a</span>';

    return `<tr>
        <td>${originCell}</td>
        <td><span class="badge ${redirectTypeBadgeClass(r.type)}">${r.type || '—'}</span></td>
        <td>${destCell}</td>
        <td><span class="badge badge-neutral">${escapeHtml(r.format)}</span></td>
        <td>${originMatch}</td>
        <td>${destMatch}</td>
        <td data-link-status-id="${rid}">${linkStatusCell}</td>
    </tr>`;
}

function renderRedirectsTable() {
    const tbody = document.getElementById('redirectsBody');
    if (!currentRedirects.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="state-msg">No redirects match the current filters/search.</td></tr>';
        return;
    }
    tbody.innerHTML = currentRedirects.map(renderRedirectRow).join('');
}

function showRedirectsState(msg, isError) {
    document.getElementById('redirectsBody').innerHTML =
        `<tr><td colspan="7" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
}

function loadRedirects() {
    showRedirectsState('<span class="spinner"></span> Loading…', false);
    updateRedirectsExportLink();

    fetch('api/redirects.php?' + qs(redirectsState))
        .then(r => r.json())
        .then(json => {
            if (!json.success) {
                currentRedirects = [];
                showRedirectsState(json.msg || 'Failed to load redirects', true);
                return;
            }
            currentRedirects = json.data;
            renderRedirectsTable();
            document.getElementById('rStTotal').textContent = json.total;
            document.getElementById('rStTotal2').textContent = json.total;
            document.getElementById('rStPage').textContent = json.page;
            document.getElementById('rStPages').textContent = json.total_pages;
            document.getElementById('rStShowing').textContent = currentRedirects.length;
            document.getElementById('rPgFirst').disabled = json.page <= 1;
            document.getElementById('rPgPrev').disabled = json.page <= 1;
            document.getElementById('rPgNext').disabled = json.page >= json.total_pages;
            document.getElementById('rPgLast').disabled = json.page >= json.total_pages;
        })
        .catch(err => {
            console.error(err);
            currentRedirects = [];
            showRedirectsState('Failed to load redirects — check the console/network tab', true);
        });
}

function goToRedirectsPage(p) {
    redirectsState.page = p;
    loadRedirects();
}

function bindRedirectsFilters() {
    document.getElementById('rSearch').addEventListener('input', () => {
        clearTimeout(redirectsDebounceTimer);
        redirectsDebounceTimer = setTimeout(() => {
            redirectsState.search = document.getElementById('rSearch').value.trim();
            redirectsState.page = 1;
            loadRedirects();
        }, 350);
    });

    document.querySelectorAll('.redirect-type-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(document.querySelectorAll('.redirect-type-cb:checked')).map(c => c.value);
            redirectsState.type = checked.join(',');
            redirectsState.page = 1;
            loadRedirects();
        });
    });

    document.getElementById('rFormat').addEventListener('change', e => {
        redirectsState.format = e.target.value;
        redirectsState.page = 1;
        loadRedirects();
    });

    document.getElementById('rMatch').addEventListener('change', e => {
        redirectsState.match = e.target.value;
        redirectsState.page = 1;
        loadRedirects();
    });

    document.getElementById('rSort').addEventListener('change', e => {
        redirectsState.sort = e.target.value;
        loadRedirects();
    });

    document.getElementById('rDir').addEventListener('click', () => {
        redirectsState.dir = redirectsState.dir === 'DESC' ? 'ASC' : 'DESC';
        document.getElementById('rDir').textContent = redirectsState.dir === 'DESC' ? '↓ DESC' : '↑ ASC';
        loadRedirects();
    });

    document.getElementById('rPerPage').addEventListener('change', e => {
        redirectsState.per_page = parseInt(e.target.value, 10);
        redirectsState.page = 1;
        loadRedirects();
    });

    document.getElementById('rLinkFilterBtn').addEventListener('click', () => {
        document.getElementById('rLinkFilterPanel').classList.toggle('open');
    });

    document.querySelectorAll('.redirect-link-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(document.querySelectorAll('.redirect-link-filter-cb:checked')).map(c => c.value);
            redirectsState.link_status = checked.join(',');
            updateRedirectsExportLink();
        });
    });

    document.getElementById('redirectsExportCsv').addEventListener('click', e => {
        if (!redirectsState.link_status) return;
        const ok = confirm('This export will live-check every matching redirect\'s origin URL before including it - it can take a while for large result sets. Continue?');
        if (!ok) e.preventDefault();
    });

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

    document.getElementById('rCheckAllLinksBtn').addEventListener('click', () => {
        redirectLinkStatus.checkAll(
            currentRedirects.map(r => ({ id: 'r' + r.id, url: r.origin_url })),
            document.getElementById('rCheckAllLinksBtn'),
            'Check all origin links (page)'
        );
    });
}

function bindRedirectsLinkStatus() {
    document.getElementById('redirectsBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-check-link');
        if (!btn) return;
        const id = btn.dataset.checkId; // "r<n>"
        const row = currentRedirects.find(r => 'r' + r.id === id);
        if (row && row.origin_url) redirectLinkStatus.check(id, row.origin_url);
    });
}

function bindViewTabs() {
    document.querySelectorAll('#viewTabs .view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#viewTabs .view-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            document.getElementById('contentView').style.display = view === 'content' ? '' : 'none';
            document.getElementById('redirectsView').style.display = view === 'redirects' ? '' : 'none';
            if (view === 'redirects' && !redirectsLoadedOnce) {
                redirectsLoadedOnce = true;
                loadRedirects();
            }
        });
    });
}

/* ══════════════════════════ Database switcher ══════════════════════════
 * Lets the whole tool (Content + Redirects, list/update/export) point at a
 * different site's database. Persisted in its own "dw_db" cookie - kept
 * separate from the "db" cookie other tools on this domain share, so
 * switching here never affects them (see api/bootstrap.php). */

function loadDatabaseSwitcher() {
    fetch('api/databases.php')
        .then(r => r.json())
        .then(json => {
            if (!json.success) return;
            const sel = document.getElementById('dbSelector');
            sel.innerHTML = json.databases.map(d =>
                `<option value="${escapeHtml(d.key)}"${d.key === json.current ? ' selected' : ''}>${escapeHtml(d.label)}</option>`
            ).join('');
        })
        .catch(err => console.error('Failed to load database list', err));
}

function bindDatabaseSwitcher() {
    document.getElementById('dbSelector').addEventListener('change', e => {
        const key = e.target.value;
        document.cookie = `dw_db=${encodeURIComponent(key)}; path=/salvadore/healthray-sql/datewise/; max-age=${60 * 60 * 24 * 365}`;
        location.reload();
    });
}

function loadFilterOptions() {
    fetch('api/filter_options.php')
        .then(r => r.json())
        .then(json => {
            if (!json.success) return;

            const stSel = document.getElementById('fStatus');
            stSel.innerHTML = json.statuses.map(s => `<option value="${s}"${s === 'publish' ? ' selected' : ''}>${s}</option>`).join('');
        })
        .catch(err => console.error('Failed to load filter options', err));
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('iconMoon').style.display = theme === 'light' ? 'none' : 'block';
    document.getElementById('iconSun').style.display = theme === 'light' ? 'block' : 'none';
}

(function initTheme() {
    const stored = localStorage.getItem('theme');
    const preferred = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(preferred);
})();

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', next);
        applyTheme(next);
    });

    bindFilters();
    bindCellEditing();
    bindLinkStatus();
    renderColumnsPanel();
    renderHead();
    updateCheckAllBtnVisibility();
    loadFilterOptions();
    loadPosts();

    bindViewTabs();
    bindRedirectsFilters();
    bindRedirectsLinkStatus();
    renderRedirectsHead();

    bindDatabaseSwitcher();
    loadDatabaseSwitcher();
});
