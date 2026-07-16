/* WP Options Panel — dashboard */
(() => {
    'use strict';

    /* ── State ── */
    const state = {
        db: '',
        column: 'option_name',
        match: 'contains',
        value: '',
        page: 1,
        per: 25,
        sort: 'option_id',
        dir: 'asc',
        total: 0,
        pages: 1,
        rows: [],
        selection: new Set(),
    };

    /* ── Elements ── */
    const $ = (id) => document.getElementById(id);
    const els = {
        dbSelect: $('db-select'),
        userChip: $('user-chip'),
        logoutBtn: $('logout-btn'),
        searchForm: $('search-form'),
        searchColumn: $('search-column'),
        searchMatch: $('search-match'),
        searchValue: $('search-value'),
        resetBtn: $('reset-btn'),
        deleteMatchedBtn: $('delete-matched-btn'),
        newBtn: $('new-btn'),
        resultsMeta: $('results-meta'),
        bulkBar: $('bulk-bar'),
        bulkCount: $('bulk-count'),
        bulkDeleteBtn: $('bulk-delete-btn'),
        bulkClearBtn: $('bulk-clear-btn'),
        checkAll: $('check-all'),
        tableHead: document.querySelector('#results-table thead'),
        body: $('results-body'),
        emptyState: $('empty-state'),
        tableLoader: $('table-loader'),
        perSelect: $('per-select'),
        pagination: $('pagination'),
        toastStack: $('toast-stack'),
    };

    /* ── Utilities ── */
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(message, type = 'info', timeout = 3500) {
        const node = document.createElement('div');
        node.className = 'toast toast-' + type;
        node.textContent = message;
        els.toastStack.appendChild(node);
        setTimeout(() => {
            node.classList.add('is-leaving');
            setTimeout(() => node.remove(), 300);
        }, timeout);
    }

    function setBusy(button, busy) {
        button.classList.toggle('is-busy', busy);
        button.disabled = busy;
    }

    function looksSerialized(value) {
        return /^(a|O|s|i|b|d):[0-9{":]/.test(value) || /^(N;)/.test(value);
    }

    /* ── Modals ── */
    function openModal(id) {
        const backdrop = $(id);
        backdrop.hidden = false;
        const focusable = backdrop.querySelector('input, textarea, select, button:not(.modal-close)');
        if (focusable) focusable.focus();
    }

    function closeModal(id) {
        $(id).hidden = true;
    }

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
        backdrop.addEventListener('mousedown', (event) => {
            if (event.target === backdrop) backdrop.hidden = true;
        });
        backdrop.querySelectorAll('[data-close]').forEach((btn) => {
            btn.addEventListener('click', () => { backdrop.hidden = true; });
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.modal-backdrop:not([hidden])').forEach((m) => { m.hidden = true; });
        }
    });

    /* ── Confirm dialog (promise-based) ── */
    let confirmResolve = null;

    function confirmDialog({ title = 'Confirm', text = '', typed = false, button = 'Delete' }) {
        $('confirm-title').textContent = title;
        $('confirm-text').textContent = text;
        $('confirm-type-wrap').hidden = !typed;
        $('confirm-type').value = '';
        $('confirm-btn').querySelector('.btn-label').textContent = button;
        openModal('modal-confirm');
        return new Promise((resolve) => { confirmResolve = resolve; });
    }

    $('confirm-btn').addEventListener('click', () => {
        if (!$('confirm-type-wrap').hidden && $('confirm-type').value.trim() !== 'DELETE') {
            toast('Type DELETE (in capitals) to confirm.', 'error');
            return;
        }
        closeModal('modal-confirm');
        if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    });

    $('modal-confirm').addEventListener('click', (event) => {
        if (event.target.matches('[data-close], .modal-close') && confirmResolve) {
            confirmResolve(false);
            confirmResolve = null;
        }
    });

    /* ── Data loading ── */
    async function loadOptions() {
        els.tableLoader.hidden = false;
        try {
            const data = await Api.get('options', {
                db: state.db,
                column: state.column,
                match: state.match,
                value: state.value,
                page: state.page,
                per: state.per,
                sort: state.sort,
                dir: state.dir,
            });
            state.rows = data.rows;
            state.total = data.total;
            state.pages = data.pages;
            state.page = data.page;
            state.selection.clear();
            render();
        } catch (e) {
            if (e.status !== 401) toast(e.message, 'error', 6000);
            state.rows = [];
            state.total = 0;
            state.pages = 1;
            render();
        } finally {
            els.tableLoader.hidden = true;
        }
    }

    /* ── Rendering ── */
    function render() {
        renderMeta();
        renderRows();
        renderPagination();
        renderSortIndicators();
        renderBulkBar();
        els.deleteMatchedBtn.disabled = state.value === '';
    }

    function renderMeta() {
        const filtered = state.value !== ''
            ? ` matching <strong>${escapeHtml(state.column)}</strong> ${escapeHtml(state.match)} “<strong>${escapeHtml(state.value)}</strong>”`
            : '';
        els.resultsMeta.innerHTML =
            `<strong>${state.total.toLocaleString()}</strong> record(s)${filtered}`;
    }

    function renderRows() {
        els.emptyState.hidden = state.rows.length > 0;
        els.checkAll.checked = false;

        els.body.innerHTML = state.rows.map((row) => {
            const truncated = row.value_length > 300;
            const autoloadOn = /^(yes|on|auto)/i.test(row.autoload);
            return `
            <tr data-id="${row.option_id}">
                <td class="col-check">
                    <input type="checkbox" class="row-check" aria-label="Select row ${row.option_id}">
                </td>
                <td>${row.option_id}</td>
                <td class="cell-name">${escapeHtml(row.option_name)}</td>
                <td>
                    <div class="cell-value">${escapeHtml(row.option_value) || '<em>(empty)</em>'}</div>
                    ${truncated ? `<span class="len-badge">${row.value_length.toLocaleString()} chars — truncated</span>` : ''}
                </td>
                <td><span class="badge ${autoloadOn ? 'badge-yes' : 'badge-no'}">${escapeHtml(row.autoload)}</span></td>
                <td class="col-actions">
                    <div class="row-actions">
                        <button type="button" class="icon-btn" data-action="view">View</button>
                        <button type="button" class="icon-btn" data-action="edit">Edit</button>
                        <button type="button" class="icon-btn danger" data-action="delete">Del</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    function renderPagination() {
        const { page, pages } = state;
        const parts = [];
        const btn = (label, target, opts = {}) =>
            `<button type="button" class="page-btn ${opts.current ? 'is-current' : ''}"
                data-page="${target}" ${opts.disabled ? 'disabled' : ''}>${label}</button>`;

        parts.push(btn('‹', page - 1, { disabled: page <= 1 }));

        const windowSize = 2;
        let last = 0;
        for (let i = 1; i <= pages; i++) {
            if (i === 1 || i === pages || Math.abs(i - page) <= windowSize) {
                if (last && i - last > 1) parts.push('<span class="page-ellipsis">…</span>');
                parts.push(btn(String(i), i, { current: i === page }));
                last = i;
            }
        }

        parts.push(btn('›', page + 1, { disabled: page >= pages }));
        els.pagination.innerHTML = parts.join('');
    }

    function renderSortIndicators() {
        els.tableHead.querySelectorAll('th.sortable').forEach((th) => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === state.sort) {
                th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });
    }

    function renderBulkBar() {
        const count = state.selection.size;
        els.bulkBar.hidden = count === 0;
        els.bulkCount.textContent = `${count} selected`;
        els.body.querySelectorAll('tr').forEach((tr) => {
            const selected = state.selection.has(Number(tr.dataset.id));
            tr.classList.toggle('is-selected', selected);
            const check = tr.querySelector('.row-check');
            if (check) check.checked = selected;
        });
    }

    /* ── Row actions ── */
    async function fetchFullOption(id) {
        const data = await Api.get('option', { id, db: state.db });
        return data.option;
    }

    async function viewOption(id) {
        try {
            const option = await fetchFullOption(id);
            $('view-id').textContent = option.option_id;
            $('view-name').textContent = option.option_name;
            $('view-autoload').textContent = option.autoload;
            $('view-length').textContent = option.option_value.length.toLocaleString() + ' chars';
            $('view-value').textContent = option.option_value || '(empty)';
            openModal('modal-view');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    let editingId = null; // null → create mode

    function setAutoloadSelect(value) {
        const select = $('edit-autoload');
        if (![...select.options].some((o) => o.value === value)) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value + ' (current)';
            select.appendChild(opt);
        }
        select.value = value;
    }

    async function editOption(id) {
        try {
            const option = await fetchFullOption(id);
            editingId = id;
            $('edit-title').textContent = `Edit option #${id}`;
            $('edit-name').value = option.option_name;
            setAutoloadSelect(option.autoload);
            $('edit-value').value = option.option_value;
            $('serialized-hint').hidden = !looksSerialized(option.option_value);
            openModal('modal-edit');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function createOption() {
        editingId = null;
        $('edit-title').textContent = 'New option';
        $('edit-name').value = '';
        setAutoloadSelect('yes');
        $('edit-value').value = '';
        $('serialized-hint').hidden = true;
        openModal('modal-edit');
    }

    async function deleteSingle(id, name) {
        const ok = await confirmDialog({
            title: 'Delete option',
            text: `Delete option #${id} (“${name}”)? This cannot be undone.`,
        });
        if (!ok) return;
        try {
            const result = await Api.post('delete', { mode: 'ids', ids: [id], db: state.db });
            toast(`Deleted ${result.deleted} record(s).`, 'success');
            loadOptions();
        } catch (e) {
            toast(e.message, 'error', 6000);
        }
    }

    /* ── Event wiring ── */
    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        state.column = els.searchColumn.value;
        state.match = els.searchMatch.value;
        state.value = els.searchValue.value.trim();
        state.page = 1;
        loadOptions();
    });

    els.resetBtn.addEventListener('click', () => {
        els.searchValue.value = '';
        els.searchColumn.value = 'option_name';
        els.searchMatch.value = 'contains';
        Object.assign(state, { column: 'option_name', match: 'contains', value: '', page: 1 });
        loadOptions();
    });

    els.perSelect.addEventListener('change', () => {
        state.per = Number(els.perSelect.value);
        state.page = 1;
        loadOptions();
    });

    els.pagination.addEventListener('click', (event) => {
        const btn = event.target.closest('.page-btn');
        if (!btn || btn.disabled) return;
        state.page = Number(btn.dataset.page);
        loadOptions();
    });

    els.tableHead.addEventListener('click', (event) => {
        const th = event.target.closest('th.sortable');
        if (!th) return;
        const column = th.dataset.sort;
        if (state.sort === column) {
            state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sort = column;
            state.dir = 'asc';
        }
        state.page = 1;
        loadOptions();
    });

    els.body.addEventListener('click', (event) => {
        const tr = event.target.closest('tr[data-id]');
        if (!tr) return;
        const id = Number(tr.dataset.id);

        if (event.target.classList.contains('row-check')) {
            if (event.target.checked) state.selection.add(id);
            else state.selection.delete(id);
            renderBulkBar();
            return;
        }

        const actionBtn = event.target.closest('[data-action]');
        if (!actionBtn) return;
        const row = state.rows.find((r) => r.option_id === id);
        switch (actionBtn.dataset.action) {
            case 'view': viewOption(id); break;
            case 'edit': editOption(id); break;
            case 'delete': deleteSingle(id, row ? row.option_name : ''); break;
        }
    });

    els.checkAll.addEventListener('change', () => {
        if (els.checkAll.checked) {
            state.rows.forEach((row) => state.selection.add(row.option_id));
        } else {
            state.selection.clear();
        }
        renderBulkBar();
    });

    els.bulkClearBtn.addEventListener('click', () => {
        state.selection.clear();
        els.checkAll.checked = false;
        renderBulkBar();
    });

    els.bulkDeleteBtn.addEventListener('click', async () => {
        const ids = [...state.selection];
        if (!ids.length) return;
        const ok = await confirmDialog({
            title: 'Delete selected',
            text: `Delete ${ids.length} selected option(s)? This cannot be undone.`,
            typed: ids.length > 5,
        });
        if (!ok) return;
        setBusy(els.bulkDeleteBtn, true);
        try {
            const result = await Api.post('delete', { mode: 'ids', ids, db: state.db });
            toast(`Deleted ${result.deleted} record(s).`, 'success');
            loadOptions();
        } catch (e) {
            toast(e.message, 'error', 6000);
        } finally {
            setBusy(els.bulkDeleteBtn, false);
        }
    });

    els.deleteMatchedBtn.addEventListener('click', async () => {
        if (state.value === '') return;
        const ok = await confirmDialog({
            title: 'Delete all matching rows',
            text: `Delete ALL ${state.total.toLocaleString()} record(s) where ${state.column} ${state.match} “${state.value}” — across every page, not just this one. This cannot be undone.`,
            typed: true,
            button: `Delete ${state.total.toLocaleString()} rows`,
        });
        if (!ok) return;
        setBusy(els.deleteMatchedBtn, true);
        try {
            const result = await Api.post('delete', {
                mode: 'match',
                column: state.column,
                match: state.match,
                value: state.value,
                confirm: true,
                db: state.db,
            });
            toast(`Deleted ${result.deleted} record(s).`, 'success');
            loadOptions();
        } catch (e) {
            toast(e.message, 'error', 6000);
        } finally {
            setBusy(els.deleteMatchedBtn, false);
        }
    });

    els.newBtn.addEventListener('click', createOption);

    $('edit-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = $('edit-name').value.trim();
        if (!name) {
            toast('Option name is required.', 'error');
            return;
        }
        const payload = {
            db: state.db,
            option_name: name,
            option_value: $('edit-value').value,
            autoload: $('edit-autoload').value,
        };
        if (editingId !== null) {
            payload.action = 'update';
            payload.option_id = editingId;
        } else {
            payload.action = 'create';
        }

        const saveBtn = $('edit-save-btn');
        setBusy(saveBtn, true);
        try {
            const result = await Api.post('save', payload);
            toast(result.message || 'Saved.', 'success');
            closeModal('modal-edit');
            loadOptions();
        } catch (e) {
            toast(e.message, 'error', 6000);
        } finally {
            setBusy(saveBtn, false);
        }
    });

    $('copy-value-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('view-value').textContent);
            toast('Value copied to clipboard.', 'success');
        } catch (e) {
            toast('Copy failed — select the text manually.', 'error');
        }
    });

    els.dbSelect.addEventListener('change', () => {
        state.db = els.dbSelect.value;
        document.cookie = 'db=' + encodeURIComponent(state.db) + '; path=/; SameSite=Strict';
        state.page = 1;
        state.selection.clear();
        loadOptions();
    });

    els.logoutBtn.addEventListener('click', async () => {
        try {
            await Api.post('logout');
        } catch (e) { /* session is gone either way */ }
        window.location.replace('login');
    });

    /* ── Init ── */
    (async () => {
        try {
            const session = await Api.get('session');
            if (!session.authenticated) {
                window.location.replace('login');
                return;
            }
            Api.setCsrf(session.csrf);
            els.userChip.textContent = session.username;

            const dbs = await Api.get('databases');
            els.dbSelect.innerHTML = dbs.databases.map((db) =>
                `<option value="${escapeHtml(db.key)}">${escapeHtml(db.label)}</option>`
            ).join('');
            state.db = dbs.current;
            els.dbSelect.value = state.db;

            document.body.classList.remove('is-loading');
            await loadOptions();
        } catch (e) {
            document.body.classList.remove('is-loading');
            if (e.status !== 401) toast(e.message, 'error', 8000);
        }
    })();
})();
