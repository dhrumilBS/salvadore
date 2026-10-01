/* ══════════════════════════ Content tab ══════════════════════════
 * Posts/Pages/CPT list with inline editing. Nothing auto-saves: an edit
 * only stages the change locally (contentDirty) and enables that row's
 * Save; every Save asks confirm() first, listing exactly what will change,
 * before anything is sent to api/update_post.php. */

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

const contentState = {
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
    per_page: 50,
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

const STATUS_OPTIONS = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];
const WIDE_URL_COLUMNS = ['permalink'];

let contentRows = [];
let visibleColumns = loadVisibleColumns();
// Edits are staged here (per post id -> field -> pending value) and only sent
// to update_post.php once the user explicitly confirms a Save - nothing is
// written to the database on change/blur alone.
let contentDirty = {};

function hasUnsavedContentEdits() {
    return Object.keys(contentDirty).some(id => Object.keys(contentDirty[id]).length);
}

/* ---------- column picker ---------- */
function loadVisibleColumns() {
    try {
        const stored = JSON.parse(localStorage.getItem('md_columns') || 'null');
        const valid = Array.isArray(stored) ? stored.filter(k => ALL_COLUMNS.some(c => c.key === k)) : [];
        if (valid.length) return valid;
    } catch (e) { /* ignore malformed/blocked storage */ }
    return ALL_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);
}

function saveVisibleColumns() {
    try { localStorage.setItem('md_columns', JSON.stringify(visibleColumns)); } catch (e) { /* storage blocked */ }
}

function activeColumns() {
    return ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));
}

function renderColumnsPanel() {
    const panel = document.getElementById('columnsPanel');
    panel.innerHTML = ALL_COLUMNS.map(c => `
        <label class="col-check">
            <input type="checkbox" data-col="${c.key}"${visibleColumns.includes(c.key) ? ' checked' : ''}>
            ${c.label}${c.exportable === false ? '<span class="col-note">not exported</span>' : ''}
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
            renderContentHead();
            renderContentTable();
            updateContentExportLink();
            updateCheckAllBtnVisibility();
        });
    });
}

function updateCheckAllBtnVisibility() {
    document.getElementById('checkAllLinksBtn').style.display =
        visibleColumns.includes('link_status') ? '' : 'none';
}

/* ---------- export ---------- */
function contentExportParams() {
    const { page, per_page, ...rest } = contentState;
    const columns = activeColumns().filter(c => c.exportable !== false).map(c => c.key).join(',');
    return { ...rest, columns };
}

function updateContentExportLink() {
    document.getElementById('exportCsv').href = 'api/export.php?' + qs(contentExportParams());
}

/* ---------- table ---------- */
function renderContentHead() {
    document.getElementById('tableHead').innerHTML =
        '<tr>' + activeColumns().map(c =>
            `<th${WIDE_URL_COLUMNS.includes(c.key) ? ' class="url-col"' : ''}>${c.label}</th>`).join('')
        + '<th>Actions</th></tr>';
}

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
            return `<td class="url-col">${urlCellHtml(r.permalink)}</td>`;
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
            return `<td>${LinkStatus.cell(r.permalink)}</td>`;
        default:
            return '<td>—</td>';
    }
}

function renderContentTable() {
    const cols = activeColumns();
    const tbody = document.getElementById('tableBody');
    if (!contentRows.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="state-msg">No posts match the current filters/search.</td></tr>`;
        applyDirtyOverlay();
        return;
    }
    tbody.innerHTML = contentRows.map(r =>
        '<tr>' + cols.map(c => renderCell(r, c.key)).join('') +
        `<td class="actions-cell"><button type="button" class="btn-save-row" data-row-id="${r.id}" disabled>Save</button></td>` +
        '</tr>').join('');
    applyDirtyOverlay();
}

function showContentState(msg, isError) {
    document.getElementById('tableBody').innerHTML =
        `<tr><td colspan="${activeColumns().length + 1}" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
}

function loadContent() {
    showContentState('<span class="spinner"></span> Loading…', false);
    updateContentExportLink();

    const { link_status, ...listParams } = contentState;
    fetch('api/list_posts.php?' + qs(listParams))
        .then(r => r.json())
        .then(json => {
            if (!json.success) {
                contentRows = [];
                showContentState(escapeHtml(json.msg || 'Failed to load posts'), true);
                return;
            }
            contentRows = json.data;
            contentState.page = json.page;
            renderContentTable();
            document.getElementById('stTotal').textContent = json.total;
            document.getElementById('stTotal2').textContent = json.total;
            document.getElementById('stPage').textContent = json.page;
            document.getElementById('stPage2').textContent = `${json.page} of ${json.total_pages}`;
            document.getElementById('stPages').textContent = json.total_pages;
            document.getElementById('stShowing').textContent = contentRows.length;
            document.getElementById('pgFirst').disabled = json.page <= 1;
            document.getElementById('pgPrev').disabled = json.page <= 1;
            document.getElementById('pgNext').disabled = json.page >= json.total_pages;
            document.getElementById('pgLast').disabled = json.page >= json.total_pages;
        })
        .catch(err => {
            console.error(err);
            contentRows = [];
            showContentState('Failed to load posts — check the console/network tab', true);
        });
}

function goToContentPage(p) {
    contentState.page = p;
    loadContent();
}

/* ---------- staged edits + confirmed save ---------- */

/** Stage an edit locally - nothing is written to the database until Save is clicked and confirmed. */
function markDirty(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;

    input.classList.remove('save-error', 'saved');
    input.classList.add('dirty');

    if (!contentDirty[id]) contentDirty[id] = {};
    contentDirty[id][field] = input.value;

    updateRowSaveButton(id);
    updateSaveBar();
}

/** Re-stamp pending edits (value + dirty styling, Save button state) onto freshly rendered rows. */
function applyDirtyOverlay() {
    Object.keys(contentDirty).forEach(id => {
        const fields = contentDirty[id];
        Object.keys(fields).forEach(field => {
            const input = document.querySelector(`#tableBody .cell-input[data-id="${id}"][data-field="${field}"]`);
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
    const count = contentDirty[id] ? Object.keys(contentDirty[id]).length : 0;
    btn.disabled = count === 0;
    btn.textContent = count ? `Save (${count})` : 'Save';
}

function updateSaveBar() {
    const ids = Object.keys(contentDirty).filter(id => Object.keys(contentDirty[id]).length);
    const bar = document.getElementById('saveBar');
    if (!ids.length) {
        bar.style.display = 'none';
        return;
    }
    const totalFields = ids.reduce((n, id) => n + Object.keys(contentDirty[id]).length, 0);
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
    const fields = contentDirty[id];
    if (!fields || !Object.keys(fields).length) return;

    const count = Object.keys(fields).length;
    const ok = confirm(`Save ${count} change${count === 1 ? '' : 's'} to post #${id}?\n\n${describeChanges(fields)}`);
    if (!ok) return;

    persistFields(id, fields);
}

async function saveAllDirty() {
    const ids = Object.keys(contentDirty).filter(id => Object.keys(contentDirty[id]).length);
    if (!ids.length) return;

    const totalFields = ids.reduce((n, id) => n + Object.keys(contentDirty[id]).length, 0);
    const preview = ids.slice(0, 8)
        .map(id => `• Post #${id}: ${Object.keys(contentDirty[id]).map(f => FIELD_LABELS[f] || f).join(', ')}`)
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
            await persistFields(id, { ...contentDirty[id] });
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

    saveAllBtn.disabled = false;
    saveAllBtn.textContent = 'Save all changes';
}

/** Send every staged field for one post to update_post.php. Fields that fail stay dirty for retry. */
async function persistFields(id, fields) {
    const rowBefore = contentRows.find(r => String(r.id) === String(id));
    const wasTrash = rowBefore ? rowBefore.status === 'trash' : true;
    const inputFor = field => document.querySelector(`#tableBody .cell-input[data-id="${id}"][data-field="${field}"]`);

    const entries = Object.entries(fields);
    entries.forEach(([field]) => {
        const input = inputFor(field);
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
        const input = inputFor(field);
        if (input) { input.disabled = false; input.classList.remove('saving'); }

        if (!json.success) {
            errors.push(`${FIELD_LABELS[field] || field}: ${json.msg || 'Save failed'}`);
            if (input) { input.classList.add('save-error'); input.title = json.msg || 'Save failed'; }
            return; // left in contentDirty so it can be retried
        }

        const savedValue = json.value ?? value;
        const row = contentRows.find(r => String(r.id) === String(id));
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

        if (contentDirty[id]) delete contentDirty[id][field];
    });

    if (contentDirty[id] && !Object.keys(contentDirty[id]).length) delete contentDirty[id];

    updateRowSaveButton(id);
    updateSaveBar();

    if (errors.length) {
        alert(`Some changes to post #${id} were not saved:\n\n${errors.join('\n')}`);
    }

    if (results.some(({ json }) => json.success)) {
        onPostsChanged(); // Links/Bulk tabs show the same posts - refresh them next time they're opened
    }

    if (slugSaved) {
        loadContent(); // permalink is derived from slug - refresh so it stays accurate; other pending edits are re-applied via applyDirtyOverlay()
    }

    const justTrashed = !wasTrash && results.some(({ field, value, json }) =>
        field === 'status' && json.success && (json.value ?? value) === 'trash');
    if (justTrashed && rowBefore && rowBefore.path) {
        offerTrashRedirect(id, rowBefore.path);
    }
}

/* ---------- binding ---------- */
function populateContentStatuses(statuses) {
    const sel = document.getElementById('fStatus');
    sel.innerHTML = Object.entries(statuses).map(([k, label]) =>
        `<option value="${escapeHtml(k)}"${k === contentState.status ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function bindContentTab() {
    const tbody = document.getElementById('tableBody');
    tbody.addEventListener('change', e => {
        const input = e.target.closest('.cell-input');
        if (input) markDirty(input);
    });
    tbody.addEventListener('click', e => {
        const btn = e.target.closest('.btn-save-row');
        if (btn) saveRow(btn.dataset.rowId);
    });
    document.getElementById('saveAllBtn').addEventListener('click', saveAllDirty);

    document.getElementById('checkAllLinksBtn').addEventListener('click', e => {
        LinkStatus.checkManyWithButton(contentRows.map(r => r.permalink), e.currentTarget, { skipChecked: true });
    });

    document.getElementById('fSearch').addEventListener('input', debounce(() => {
        contentState.search = document.getElementById('fSearch').value.trim();
        contentState.page = 1;
        loadContent();
    }, 350));

    [['fStatus', 'status'], ['fSort', 'sort']].forEach(([id, key]) => {
        document.getElementById(id).addEventListener('change', e => {
            contentState[key] = e.target.value;
            contentState.page = 1;
            loadContent();
        });
    });

    document.getElementById('fPostTypeTabs').addEventListener('click', e => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        document.querySelectorAll('#fPostTypeTabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        contentState.post_type = tab.dataset.type;
        contentState.page = 1;
        loadContent();
    });

    [['fDateFrom', 'date_from'], ['fDateTo', 'date_to'], ['fModFrom', 'mod_from'], ['fModTo', 'mod_to']]
        .forEach(([id, key]) => {
            document.getElementById(id).addEventListener('change', e => {
                contentState[key] = e.target.value;
                contentState.page = 1;
                loadContent();
            });
        });

    document.getElementById('fPerPage').addEventListener('change', e => {
        contentState.per_page = parseInt(e.target.value, 10);
        contentState.page = 1;
        loadContent();
    });

    document.getElementById('fDir').addEventListener('click', () => {
        contentState.dir = contentState.dir === 'DESC' ? 'ASC' : 'DESC';
        document.getElementById('fDir').textContent = contentState.dir === 'DESC' ? '↓ DESC' : '↑ ASC';
        loadContent();
    });

    bindPanelToggle('moreFiltersBtn', 'moreFilters');
    bindPanelToggle('columnsBtn', 'columnsPanel');
    bindPanelToggle('linkFilterBtn', 'linkFilterPanel');

    document.querySelectorAll('.link-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            contentState.link_status = Array.from(document.querySelectorAll('.link-filter-cb:checked')).map(c => c.value).join(',');
            updateContentExportLink();
        });
    });

    document.getElementById('exportCsv').addEventListener('click', e => {
        if (!contentState.link_status) return;
        const ok = confirm('This export will live-check every matching post\'s URL before including it - it can take minutes for large result sets. Continue?');
        if (!ok) e.preventDefault();
    });

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
        Object.assign(contentState, {
            post_type: 'post', status: 'publish',
            date_from: '', date_to: '', mod_from: '', mod_to: '', search: '', page: 1,
        });
        document.querySelectorAll('#fPostTypeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.type === 'post'));
        document.getElementById('fStatus').value = 'publish';
        ['fDateFrom', 'fDateTo', 'fModFrom', 'fModTo', 'fSearch'].forEach(id => { document.getElementById(id).value = ''; });
        loadContent();
    });

    document.getElementById('pgFirst').addEventListener('click', () => goToContentPage(1));
    document.getElementById('pgPrev').addEventListener('click', () => goToContentPage(Math.max(1, contentState.page - 1)));
    document.getElementById('pgNext').addEventListener('click', () => goToContentPage(contentState.page + 1));
    document.getElementById('pgLast').addEventListener('click', () => goToContentPage(parseInt(document.getElementById('stPages').textContent, 10)));

    window.addEventListener('beforeunload', e => {
        if (hasUnsavedContentEdits()) { e.preventDefault(); e.returnValue = ''; }
    });

    renderColumnsPanel();
    renderContentHead();
    updateCheckAllBtnVisibility();
}
