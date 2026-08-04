const API_URL = './api/list_templates.php';
const STATUS_API_URL = './api/check_url_status.php';
const UPDATE_URL = './api/update_post.php';
const BULK_UPDATE_URL = './api/bulk_update_post.php';
// Browsers cap concurrent connections per origin at ~6 (HTTP/1.1). Status
// checks hit this same origin, so concurrency is kept below that cap to
// leave headroom for other same-origin requests (Save, bulk Save, Load)
// to go through while a refresh is still running.
const STATUS_CHECK_CONCURRENCY = 4;

const STATUSES = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];

const pageTitle = document.getElementById('pageTitle');
const statusBox = document.getElementById('statusBox');
const summaryBar = document.getElementById('summaryBar');
const tableBody = document.getElementById('tableBody');
const templateSelect = document.getElementById('templateSelect');
const bestInput = document.getElementById('bestInput');
const loadButton = document.getElementById('loadButton');
const refreshStatusButton = document.getElementById('refreshStatusButton');
const metaRow = document.getElementById('metaRow');
const searchInput = document.getElementById('searchInput');
const issuesOnlyToggle = document.getElementById('issuesOnlyToggle');
const selectAllCheckbox = document.getElementById('selectAll');
const bulkBar = document.getElementById('bulkBar');
const selCount = document.getElementById('selCount');
const bulkStatus = document.getElementById('bulkStatus');
const clearSelBtn = document.getElementById('clearSelBtn');
const bulkSaveBtn = document.getElementById('bulkSaveBtn');
const toastStack = document.getElementById('toastStack');
const adhocUrlInput = document.getElementById('adhocUrlInput');
const adhocCheckBtn = document.getElementById('adhocCheckBtn');
const adhocResult = document.getElementById('adhocResult');

const TABLE_COLSPAN = 12;

let currentRows = [];
const dirty = new Set();

const defaultTemplate = document.body.dataset.defaultTemplate || 'All';
const defaultBest = document.body.dataset.defaultBest || '';

function getActiveTemplate() {
    return templateSelect ? templateSelect.value : defaultTemplate;
}

function getActiveBest() {
    return bestInput ? bestInput.value.trim() : defaultBest;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function statusOptions(current) {
    return STATUSES
        .map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`)
        .join('');
}

function showToast(message, success = true) {
    if (!toastStack) return;
    const toast = document.createElement('div');
    toast.className = `toast-item ${success ? 'toast-item--success' : 'toast-item--error'}`;
    toast.textContent = message;
    toastStack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-item--visible'));
    setTimeout(() => {
        toast.classList.remove('toast-item--visible');
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

function updateMetaRowVisibility() {
    if (!metaRow) return;
    metaRow.style.display = templateSelect && templateSelect.value === 'META' ? 'block' : 'none';
}

// Guards against out-of-order responses: the page auto-loads the default
// template on window "load", and a user can pick + Load a different one
// before that first (often much larger, slower) request finishes. Without
// this, whichever response arrives last wins and can silently overwrite the
// template the user actually asked for. Only the most recently issued
// request is allowed to render.
let loadRequestSeq = 0;
let loadAbortController = null;

async function loadTemplateData(template = defaultTemplate, best = defaultBest) {
    const seq = ++loadRequestSeq;
    if (loadAbortController) loadAbortController.abort();
    loadAbortController = new AbortController();

    const searchParams = new URLSearchParams();
    searchParams.set('template', template);
    if (best) searchParams.set('best', best);
    const url = `${API_URL}?${searchParams.toString()}`;

    statusBox.textContent = 'Loading records…';
    resetStatusCounts();
    dirty.clear();
    tableBody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}" class="text-center py-5 text-muted">Loading data…</td></tr>`;
    if (loadButton) { loadButton.disabled = true; loadButton.textContent = 'Loading…'; }

    try {
        const response = await fetch(url, { signal: loadAbortController.signal });
        if (seq !== loadRequestSeq) return; // a newer load has since started
        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }
        const result = await response.json();
        if (seq !== loadRequestSeq) return;
        if (!result.success) {
            throw new Error(result.error || result.msg || 'Unknown API error');
        }

        if (pageTitle) {
            pageTitle.textContent = result.headerText || 'StateCity records';
        }
        renderTable(result.data);
        statusBox.textContent = `${result.data.length} top-level records loaded for ${result.template === 'ALL' ? 'All templates' : result.template}.`;
    } catch (err) {
        if (err.name === 'AbortError' || seq !== loadRequestSeq) return;
        tableBody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}" class="text-center py-5 text-danger">Unable to load data.</td></tr>`;
        statusBox.textContent = err.message;
    } finally {
        if (seq === loadRequestSeq && loadButton) {
            loadButton.disabled = false;
            loadButton.textContent = 'Load';
        }
    }
}

function rowSearchText(id, template) {
    const title = document.getElementById(`title-${id}`);
    const name = document.getElementById(`name-${id}`);
    const status = document.getElementById(`status-${id}`);
    return [title ? title.value : '', name ? name.value : '', status ? status.value : '', id, template || '']
        .join(' ')
        .toLowerCase();
}

function buildRowHtml(entry, rowIndex, indexLabel, template, isChild) {
    const id = entry.id;
    const hasUrl = Boolean(entry.post_name);
    const url = `https://healthray.com/${escapeHtml(entry.post_name)}/`;
    const statusCellContent = hasUrl
        ? `<button type="button" class="check-single-btn" data-id="${id}" title="Check this URL now">⟳</button>` +
          `<span class="status-value"><span class="status-badge status-badge--pending">Pending</span></span>`
        : `<span class="status-value text-muted">No URL</span>`;
    return `<tr class="${isChild ? 'child-row' : ''}" data-id="${id}">` +
        `<td class="col-check"><input type="checkbox" class="form-check-input row-check" value="${id}"></td>` +
        `<td>${rowIndex}</td>` +
        `<td>${indexLabel}</td>` +
        `<td>${escapeHtml(template || '')}</td>` +
        `<td>${escapeHtml(id)}</td>` +
        `<td><input class="form-control form-control-sm field" data-f="post_title" id="title-${id}" value="${escapeHtml(entry.post_title)}"></td>` +
        `<td><input class="form-control form-control-sm field" data-f="post_name" id="name-${id}" value="${escapeHtml(entry.post_name)}"></td>` +
        `<td><select class="form-select form-select-sm field status-select status--${escapeHtml(entry.post_status)}" data-f="post_status" id="status-${id}">${statusOptions(entry.post_status)}</select></td>` +
        `<td class="guid-cell"><a href="${url}" target="_blank" rel="noopener">${url}</a></td>` +
        `<td class="status-cell" data-url="${hasUrl ? url : ''}" id="urlstatus-${id}">${statusCellContent}</td>` +
        `<td class="redirect-cell" id="redirect-${id}">-</td>` +
        `<td class="col-save"><button class="btn btn-primary btn-sm save-btn" data-id="${id}">Save</button></td>` +
        `</tr>`;
}

function renderTable(rows) {
    if (!rows || !rows.length) {
        tableBody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}" class="text-center py-5 text-muted">No records found.</td></tr>`;
        currentRows = [];
        updateSelectionUI();
        return;
    }

    currentRows = rows;
    let html = '';
    let rowIndex = 0;

    rows.forEach((row, mainIndex) => {
        rowIndex++;
        html += buildRowHtml(row, rowIndex, mainIndex + 1, row.template, false);

        if (Array.isArray(row.cityData)) {
            row.cityData.forEach((child, childIndex) => {
                rowIndex++;
                html += buildRowHtml(child, rowIndex, `${mainIndex + 1}.${childIndex + 1}`, row.template, true);
            });
        }
    });

    tableBody.innerHTML = html;
    updateSelectionUI();
    applyFilters();
}

async function fetchUrlStatus(url) {
    if (!url) {
        return { success: false, error: 'No URL provided' };
    }

    try {
        const response = await fetch(`${STATUS_API_URL}?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            return { success: false, error: `Status API returned ${response.status}` };
        }
        return await response.json();
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function renderStatusBadge(result) {
    if (!result.success) {
        return `<span class="status-badge status-badge--error" title="${escapeHtml(result.error || 'Failed')}">Error</span>`;
    }

    const code = result.status_code || 0;
    if (result.is_gone) {
        return `<span class="status-badge status-badge--gone">410 Gone</span>`;
    }
    if (result.is_not_found) {
        return `<span class="status-badge status-badge--missing">404 Not Found</span>`;
    }
    if (result.is_redirect) {
        return `<span class="status-badge status-badge--redirect">${code} Redirect</span>`;
    }
    if (result.is_error || code === 0) {
        return `<span class="status-badge status-badge--error">${code || 'N/A'}</span>`;
    }
    if (code === 200) {
        return `<span class="status-badge status-badge--ok">200 OK</span>`;
    }
    return `<span class="status-badge status-badge--unknown">${code}</span>`;
}

function rowIsIssue(result) {
    if (!result.success) return true;
    return Boolean(result.is_gone || result.is_not_found || result.is_redirect || result.is_error);
}

// Running per-category tally across every row checked so far in the current
// table (via bulk refresh and/or individual per-row checks). Each row
// remembers its own last-known category so a re-check (single or bulk)
// correctly moves it out of its old bucket before landing in the new one.
const CATEGORY_LABELS = {
    ok: 'OK',
    redirect: 'Redirect',
    gone: 'Gone (410)',
    missing: 'Not Found (404)',
    unknown: 'Unknown',
    error: 'Error',
    noUrl: 'No URL',
};
const CATEGORY_ORDER = ['ok', 'redirect', 'gone', 'missing', 'unknown', 'error', 'noUrl'];
let statusCounts = {};

function resetStatusCounts() {
    statusCounts = {};
    summaryBar.style.display = 'none';
    summaryBar.innerHTML = '';
}

function computeCategory(result) {
    if (!result.success) return 'error';
    const code = result.status_code || 0;
    if (result.is_gone) return 'gone';
    if (result.is_not_found) return 'missing';
    if (result.is_redirect) return 'redirect';
    if (result.is_error || code === 0) return 'error';
    if (code === 200) return 'ok';
    return 'unknown';
}

function renderSummaryBar() {
    const chips = CATEGORY_ORDER
        .filter(key => statusCounts[key])
        .map(key => `<span class="summary-chip summary-chip--${key === 'noUrl' ? 'muted' : key}">${statusCounts[key]} ${CATEGORY_LABELS[key]}</span>`)
        .join('');
    summaryBar.innerHTML = chips;
    summaryBar.style.display = chips ? 'flex' : 'none';
}

function setRowCategory(tr, category) {
    const old = tr.dataset.statusCategory;
    if (old) statusCounts[old] = Math.max(0, (statusCounts[old] || 0) - 1);
    if (category) statusCounts[category] = (statusCounts[category] || 0) + 1;
    tr.dataset.statusCategory = category || '';
    renderSummaryBar();
}

// Shared by both the per-row "check this one" button and the bulk refresh -
// keeps badge rendering, issue flagging and the summary tally in one place
// so the two entry points can never drift out of sync.
function applyUrlCheckResult(tr, statusValueEl, redirectCell, result) {
    statusValueEl.innerHTML = renderStatusBadge(result);
    tr.dataset.issue = rowIsIssue(result) ? 'true' : 'false';
    tr.dataset.statusCode = result.status_code || '';
    setRowCategory(tr, computeCategory(result));

    if (redirectCell) {
        redirectCell.textContent = result.redirect_url || (result.is_redirect ? 'Unknown redirect' : '-');
    }
}

async function runWithConcurrency(items, worker, limit) {
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const current = cursor++;
            await worker(items[current], current);
        }
    }
    const poolSize = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: poolSize }, next));
}

// Check a single row's URL on demand, without touching any other row.
async function checkSingleUrl(id) {
    const tr = tableBody.querySelector(`tr[data-id="${id}"]`);
    if (!tr) return;

    const cell = tr.querySelector('.status-cell');
    const statusValueEl = cell?.querySelector('.status-value');
    const redirectCell = tr.querySelector('.redirect-cell');
    const btn = tr.querySelector('.check-single-btn');
    const url = cell?.dataset.url;

    if (!url || !statusValueEl) {
        showToast('This row has no URL to check', false);
        return;
    }

    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    statusValueEl.innerHTML = '<span class="status-badge status-badge--pending">Checking…</span>';

    const result = await fetchUrlStatus(url);
    applyUrlCheckResult(tr, statusValueEl, redirectCell, result);
    applyFilters();

    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
}

async function refreshUrlStatuses() {
    if (!currentRows || !currentRows.length) {
        statusBox.textContent = 'No rows to refresh.';
        return;
    }

    const statusCells = Array.from(tableBody.querySelectorAll('.status-cell[data-url]'));
    if (!statusCells.length) {
        statusBox.textContent = 'No URLs found to check.';
        return;
    }

    refreshStatusButton.disabled = true;
    refreshStatusButton.textContent = 'Checking…';
    statusBox.textContent = `Checking ${statusCells.length} URLs…`;
    resetStatusCounts();

    await runWithConcurrency(statusCells, async (cell) => {
        const url = cell.dataset.url;
        const tr = cell.closest('tr');
        const statusValueEl = cell.querySelector('.status-value');
        const redirectCell = tr.querySelector('.redirect-cell');
        const btn = cell.querySelector('.check-single-btn');

        if (!url) {
            setRowCategory(tr, 'noUrl');
            tr.dataset.issue = 'false';
            return;
        }

        if (btn) btn.classList.add('spinning');
        statusValueEl.innerHTML = '<span class="status-badge status-badge--pending">Checking…</span>';
        const result = await fetchUrlStatus(url);
        applyUrlCheckResult(tr, statusValueEl, redirectCell, result);
        if (btn) btn.classList.remove('spinning');
    }, STATUS_CHECK_CONCURRENCY);

    refreshStatusButton.disabled = false;
    refreshStatusButton.textContent = '⟳ Refresh URL status';

    const issueTotal = (statusCounts.redirect || 0) + (statusCounts.gone || 0) + (statusCounts.missing || 0) + (statusCounts.error || 0);
    statusBox.textContent = issueTotal
        ? `URL status refreshed for ${statusCells.length} records — ${issueTotal} need attention (redirects, 410s, 404s or errors).`
        : `URL status refreshed for ${statusCells.length} records — all clear.`;

    applyFilters();
}

async function checkAdhocUrl() {
    const url = adhocUrlInput.value.trim();
    if (!url) {
        showToast('Enter a URL to check', false);
        return;
    }

    adhocCheckBtn.disabled = true;
    adhocCheckBtn.textContent = 'Checking…';
    adhocResult.innerHTML = '<span class="status-badge status-badge--pending">Checking…</span>';

    const result = await fetchUrlStatus(url);
    adhocResult.innerHTML = renderStatusBadge(result) +
        (result.redirect_url ? ` <span class="adhoc-redirect">→ ${escapeHtml(result.redirect_url)}</span>` : '');

    adhocCheckBtn.disabled = false;
    adhocCheckBtn.textContent = 'Check URL';
}

function readRow(id) {
    const row = currentRows.length ? findEntryById(id) : {};
    return {
        id,
        post_title: document.getElementById(`title-${id}`)?.value ?? '',
        post_name: document.getElementById(`name-${id}`)?.value ?? '',
        post_status: document.getElementById(`status-${id}`)?.value ?? (row.post_status || 'publish'),
    };
}

function findEntryById(id) {
    for (const row of currentRows) {
        if (String(row.id) === String(id)) return row;
        if (Array.isArray(row.cityData)) {
            const child = row.cityData.find(c => String(c.id) === String(id));
            if (child) return child;
        }
    }
    return {};
}

function syncEntryCache(data) {
    const entry = findEntryById(data.id);
    if (entry) Object.assign(entry, data);
}

async function updatePost(id) {
    const data = readRow(id);
    const btn = tableBody.querySelector(`.save-btn[data-id="${id}"]`);
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    try {
        const response = await fetch(UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(data),
        });
        const result = await response.json();
        showToast(result.msg, result.success);
        if (result.success) {
            syncEntryCache(data);
            dirty.delete(String(id));
            const tr = tableBody.querySelector(`tr[data-id="${id}"]`);
            if (tr) tr.classList.remove('row--dirty');
            if (btn) { btn.classList.remove('btn-warning'); btn.classList.add('btn-primary'); }
        }
    } catch (err) {
        showToast(`Request failed: ${err.message}`, false);
    } finally {
        if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    }
}

async function bulkSave() {
    const ids = Array.from(tableBody.querySelectorAll('.row-check:checked')).map(el => el.value);
    if (!ids.length) {
        showToast('Select at least one row', false);
        return;
    }

    const overrideStatus = bulkStatus.value;
    const payload = ids.map(id => {
        const row = readRow(id);
        if (overrideStatus) row.post_status = overrideStatus;
        return row;
    });

    bulkSaveBtn.disabled = true;
    bulkSaveBtn.textContent = 'Saving…';

    try {
        const response = await fetch(BULK_UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ posts: JSON.stringify(payload) }),
        });
        const result = await response.json();
        showToast(result.msg, result.success);
        if (result.success) {
            payload.forEach(syncEntryCache);
            payload.forEach(p => dirty.delete(String(p.id)));
            bulkStatus.value = '';
            payload.forEach(p => {
                const tr = tableBody.querySelector(`tr[data-id="${p.id}"]`);
                if (tr) tr.classList.remove('row--dirty');
                if (overrideStatus) {
                    const sel = document.getElementById(`status-${p.id}`);
                    if (sel) {
                        sel.value = overrideStatus;
                        sel.className = sel.className.replace(/status--\S+/g, '') + ` status--${overrideStatus}`;
                    }
                }
            });
            tableBody.querySelectorAll('.row-check:checked').forEach(el => el.checked = false);
            selectAllCheckbox.checked = false;
            updateSelectionUI();
        }
    } catch (err) {
        showToast(`Request failed: ${err.message}`, false);
    } finally {
        bulkSaveBtn.disabled = false;
        bulkSaveBtn.textContent = '💾 Save selected';
    }
}

function updateSelectionUI() {
    const checks = tableBody.querySelectorAll('.row-check');
    const checked = tableBody.querySelectorAll('.row-check:checked');
    selCount.textContent = checked.length;
    bulkBar.classList.toggle('bulk-bar--active', checked.length > 0);
    selectAllCheckbox.checked = checks.length > 0 && checked.length === checks.length;
}

function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const issuesOnly = issuesOnlyToggle.checked;

    tableBody.querySelectorAll('tr[data-id]').forEach(tr => {
        const id = tr.dataset.id;
        const template = tr.children[3]?.textContent || '';
        const matchesSearch = !query || rowSearchText(id, template).includes(query);
        const matchesIssue = !issuesOnly || tr.dataset.issue === 'true';
        tr.style.display = matchesSearch && matchesIssue ? '' : 'none';
    });
}

if (templateSelect) {
    templateSelect.addEventListener('change', updateMetaRowVisibility);
}

if (loadButton) {
    loadButton.addEventListener('click', () => {
        loadTemplateData(getActiveTemplate(), getActiveBest());
    });
}

if (refreshStatusButton) {
    refreshStatusButton.addEventListener('click', () => {
        refreshUrlStatuses();
    });
}

searchInput.addEventListener('input', applyFilters);
issuesOnlyToggle.addEventListener('change', applyFilters);

selectAllCheckbox.addEventListener('change', function () {
    tableBody.querySelectorAll('.row-check').forEach(el => el.checked = this.checked);
    updateSelectionUI();
});

tableBody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-check')) {
        updateSelectionUI();
        return;
    }
    if (e.target.classList.contains('field')) {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        dirty.add(String(id));
        tr.classList.add('row--dirty');
        const saveBtn = tr.querySelector('.save-btn');
        if (saveBtn) { saveBtn.classList.remove('btn-primary'); saveBtn.classList.add('btn-warning'); }
        if (e.target.classList.contains('status-select')) {
            e.target.className = e.target.className.replace(/status--\S+/g, '') + ` status--${e.target.value}`;
        }
    }
});

tableBody.addEventListener('input', (e) => {
    if (e.target.classList.contains('field')) applyFilters();
});

tableBody.addEventListener('click', (e) => {
    const saveBtn = e.target.closest('.save-btn');
    if (saveBtn) { updatePost(saveBtn.dataset.id); return; }

    const checkBtn = e.target.closest('.check-single-btn');
    if (checkBtn) { checkSingleUrl(checkBtn.dataset.id); return; }
});

tableBody.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('field')) return;
    const id = e.target.closest('tr').dataset.id;
    if (e.key === 'Enter') { e.preventDefault(); updatePost(id); }
    if (e.key === 'Escape') { e.target.blur(); }
});

clearSelBtn.addEventListener('click', () => {
    tableBody.querySelectorAll('.row-check').forEach(el => el.checked = false);
    selectAllCheckbox.checked = false;
    updateSelectionUI();
});

bulkSaveBtn.addEventListener('click', bulkSave);

adhocCheckBtn.addEventListener('click', checkAdhocUrl);
adhocUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); checkAdhocUrl(); }
});

window.addEventListener('beforeunload', (e) => {
    if (dirty.size > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

window.addEventListener('load', () => {
    updateMetaRowVisibility();
    loadTemplateData(getActiveTemplate(), getActiveBest());
});
