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

let currentRows = [];
let debounceTimer = null;
let visibleColumns = loadVisibleColumns();

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
        '<tr>' + activeColumns().map(c => `<th>${c.label}</th>`).join('') + '</tr>';
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
            return `<td data-link-status-id="${r.id}">${renderLinkStatusContent(r.id)}</td>`;
        default:
            return '<td>—</td>';
    }
}

const linkStatusCache = {};

function linkStatusClass(code) {
    if (code >= 200 && code < 300) return 'ls-ok';
    if (code >= 300 && code < 400) return 'ls-redirect';
    if (code === 404 || code === 410) return 'ls-gone';
    return 'ls-error';
}

function renderLinkStatusContent(id) {
    const s = linkStatusCache[id];
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

function updateLinkStatusCell(id) {
    const cell = document.querySelector(`[data-link-status-id="${id}"]`);
    if (cell) cell.innerHTML = renderLinkStatusContent(id);
}

async function checkLink(id, url) {
    linkStatusCache[id] = { checking: true };
    updateLinkStatusCell(id);
    try {
        const res = await fetch('api/check_url_status.php?url=' + encodeURIComponent(url));
        const json = await res.json();
        linkStatusCache[id] = json.success
            ? { status_code: json.status_code, redirect_url: json.redirect_url }
            : { error: json.msg || 'Check failed' };
    } catch (err) {
        console.error(err);
        linkStatusCache[id] = { error: 'Network error' };
    }
    updateLinkStatusCell(id);
}

async function checkAllVisibleLinks() {
    const btn = document.getElementById('checkAllLinksBtn');
    const targets = currentRows.filter(r => !linkStatusCache[r.id] || linkStatusCache[r.id].error);
    if (!targets.length) return;

    btn.disabled = true;
    let done = 0;
    const CONCURRENCY = 4;
    let next = 0;
    async function worker() {
        while (next < targets.length) {
            const r = targets[next++];
            await checkLink(r.id, r.permalink);
            done++;
            btn.textContent = `Checking… (${done}/${targets.length})`;
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    btn.disabled = false;
    btn.textContent = 'Check all links (page)';
}

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
        if (row) checkLink(id, row.permalink);
    });
    document.getElementById('checkAllLinksBtn').addEventListener('click', checkAllVisibleLinks);
}

function bindCellEditing() {
    document.getElementById('tableBody').addEventListener('change', e => {
        const input = e.target.closest('.cell-input');
        if (input) saveCell(input);
    });
}

function saveCell(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;
    const value = input.value;

    input.classList.remove('save-error', 'saved');
    input.classList.add('saving');
    input.disabled = true;
    input.title = '';

    fetch('api/update_post.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id, field, value }),
    })
        .then(r => r.json())
        .then(json => {
            input.disabled = false;
            input.classList.remove('saving');

            if (!json.success) {
                input.classList.add('save-error');
                input.title = json.msg || 'Save failed';
                return;
            }

            const savedValue = json.value ?? value;
            const row = currentRows.find(r => String(r.id) === String(id));
            if (row) row[field] = savedValue;

            if (field === 'slug') {
                loadPosts(); // permalink is derived from slug - refresh so it stays accurate
                return;
            }
            if (field === 'publish_date') {
                input.value = toDatetimeLocal(savedValue);
            } else if (input.tagName !== 'SELECT') {
                input.value = savedValue;
            }
            input.classList.add('saved');
            setTimeout(() => input.classList.remove('saved'), 900);
        })
        .catch(err => {
            console.error(err);
            input.disabled = false;
            input.classList.remove('saving');
            input.classList.add('save-error');
            input.title = 'Network error - not saved';
        });
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

function renderTable() {
    const cols = activeColumns();
    const tbody = document.getElementById('tableBody');
    if (!currentRows.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length}" class="state-msg">No posts match the current filters/search.</td></tr>`;
        return;
    }
    tbody.innerHTML = currentRows.map(r =>
        '<tr>' + cols.map(c => renderCell(r, c.key)).join('') + '</tr>').join('');
}

function showTableState(msg, isError) {
    document.getElementById('tableBody').innerHTML =
        `<tr><td colspan="${activeColumns().length}" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
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
});
