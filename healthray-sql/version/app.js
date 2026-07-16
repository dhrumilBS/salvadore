// ---------------------------------------------------------------------
// wp_posts › revision — front-end logic
// Talks to api.php (?action=list for GET, action=delete_revisions for POST)
// Fully custom UI: no framework dependency for modal / collapse / pills.
// ---------------------------------------------------------------------

const state = {
    pt: 'all',
    parent_id: '',
    page: 1,
};

const els = {};
const MAX_TICKS = 40;
const PROTECTED_COUNT = 5; // most recent revisions per post that can't be deleted
let idsToDelete = [];
let debounceTimer = null;
const pageStats = { totalGroups: 0, revisionsOnPage: 0, metaOnPage: 0 };

document.addEventListener('DOMContentLoaded', function () {
    els.groupsContainer = document.getElementById('groupsContainer');
    els.ptPills = document.getElementById('ptPills');
    els.parentIdInput = document.getElementById('parentIdInput');
    els.resetBtn = document.getElementById('resetBtn');
    els.expandAllBtn = document.getElementById('expandAllBtn');
    els.collapseAllBtn = document.getElementById('collapseAllBtn');
    els.summary = document.getElementById('summary');
    els.pagination = document.getElementById('pagination');
    els.alertContainer = document.getElementById('alertContainer');

    els.selectionBar = document.getElementById('selectionBar');
    els.selectionText = document.getElementById('selectionText');
    els.clearSelectionBtn = document.getElementById('clearSelectionBtn');
    els.deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

    els.modal = document.getElementById('confirmModal');
    els.modalBody = document.getElementById('confirmModalBody');
    els.modalCloseBtn = document.getElementById('modalCloseBtn');
    els.modalCancelBtn = document.getElementById('modalCancelBtn');
    els.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    els.helpModal = document.getElementById('helpModal');
    els.helpCloseBtn = document.getElementById('helpCloseBtn');
    els.shortcutsBtn = document.getElementById('shortcutsBtn');

    // ---- Filter pills ----
    els.ptPills.addEventListener('click', function (e) {
        const btn = e.target.closest('.pill');
        if (!btn) return;
        els.ptPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        state.pt = btn.dataset.pt;
        state.page = 1;
        loadData();
    });

    // ---- Parent id filter (debounced) ----
    els.parentIdInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            state.parent_id = els.parentIdInput.value.trim();
            state.page = 1;
            loadData();
        }, 350);
    });

    els.resetBtn.addEventListener('click', function () {
        els.parentIdInput.value = '';
        els.ptPills.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.pt === 'all'));
        state.pt = 'all';
        state.parent_id = '';
        state.page = 1;
        loadData();
    });

    // ---- Expand / collapse all ----
    els.expandAllBtn.addEventListener('click', () => setAllGroups(true));
    els.collapseAllBtn.addEventListener('click', () => setAllGroups(false));

    // ---- Selection bar ----
    els.clearSelectionBtn.addEventListener('click', function () {
        document.querySelectorAll('.row-checkbox:checked').forEach(cb => {
            cb.checked = false;
            cb.closest('.rev-row').classList.remove('selected');
        });
        document.querySelectorAll('.group-select-all').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
        updateSelectionBar();
    });


    els.deleteSelectedBtn.addEventListener('click', function () {
        const ids = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
        if (ids.length) openConfirm(ids);
    });

    // ---- Modal ----
    els.modalCloseBtn.addEventListener('click', closeModal);
    els.modalCancelBtn.addEventListener('click', closeModal);
    els.modal.addEventListener('click', function (e) { if (e.target === els.modal) closeModal(); });
    els.confirmDeleteBtn.addEventListener('click', doDelete);

    // ---- Shortcuts help ----
    els.shortcutsBtn.addEventListener('click', toggleHelp);
    els.helpCloseBtn.addEventListener('click', closeHelp);
    els.helpModal.addEventListener('click', function (e) { if (e.target === els.helpModal) closeHelp(); });

    document.addEventListener('keydown', handleShortcuts);

    loadData();
});

// =====================================================================
// Keyboard shortcuts
// =====================================================================
function handleShortcuts(e) {
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

    // Ctrl/Cmd+K focuses the filter from anywhere, even while typing elsewhere
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        els.parentIdInput.focus();
        els.parentIdInput.select();
        return;
    }

    // Escape: close help → close modal → leave input → clear selection
    if (e.key === 'Escape') {
        if (els.helpModal.classList.contains('open')) { closeHelp(); return; }
        if (els.modal.classList.contains('open')) { closeModal(); return; }
        if (typing) { active.blur(); return; }
        if (document.querySelector('.row-checkbox:checked')) els.clearSelectionBtn.click();
        return;
    }

    if (typing) return;                                   // don't hijack typing
    if (e.ctrlKey || e.metaKey || e.altKey) return;       // leave browser shortcuts alone
    if (els.modal.classList.contains('open')) {
        if (e.key === 'Enter') { e.preventDefault(); els.confirmDeleteBtn.click(); }
        return;
    }
    if (els.helpModal.classList.contains('open')) return;

    switch (e.key) {
        case '/':
            e.preventDefault();
            els.parentIdInput.focus();
            els.parentIdInput.select();
            break;
        case '?':
            toggleHelp();
            break;
        case '1': setPill('all'); break;
        case '2': setPill('post'); break;
        case '3': setPill('page'); break;
        case '4': setPill('whitepaper'); break;
        case '5': setPill('case-studies'); break;
        case 'e': case 'E': setAllGroups(true); break;
        case 'c': case 'C': setAllGroups(false); break;
        case 'a': case 'A':
            e.preventDefault();
            toggleSelectAllOnPage();
            break;
        case 'r': case 'R': loadData(); break;
        case 'Delete': {
            const ids = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
            if (ids.length) openConfirm(ids);
            break;
        }
        case 'ArrowLeft': clickIfEnabled('prevPageBtn'); break;
        case 'ArrowRight': clickIfEnabled('nextPageBtn'); break;
    }
}

function setPill(pt) {
    const pill = els.ptPills.querySelector(`.pill[data-pt="${pt}"]`);
    if (pill && !pill.classList.contains('active')) pill.click();
}

function clickIfEnabled(id) {
    const btn = document.getElementById(id);
    if (btn && !btn.disabled) btn.click();
}

function toggleSelectAllOnPage() {
    const boxes = document.querySelectorAll('.row-checkbox');
    if (!boxes.length) return;
    const allChecked = Array.from(boxes).every(cb => cb.checked);
    boxes.forEach(cb => {
        cb.checked = !allChecked;
        cb.closest('.rev-row').classList.toggle('selected', cb.checked);
    });
    document.querySelectorAll('.group').forEach(syncGroupCheckbox);
    updateSelectionBar();
}

function toggleHelp() {
    if (els.helpModal.classList.contains('open')) closeHelp(); else openHelp();
}
function openHelp() { els.helpModal.classList.add('open'); els.helpModal.setAttribute('aria-hidden', 'false'); }
function closeHelp() { els.helpModal.classList.remove('open'); els.helpModal.setAttribute('aria-hidden', 'true'); }

// =====================================================================
// Data loading
// =====================================================================
function loadData() {
    els.groupsContainer.innerHTML = `
        <div class="loading-state"><span class="spinner"></span> scanning wp_posts for revisions&hellip;</div>`;

    const params = new URLSearchParams({ action: 'list', pt: state.pt, page: state.page });
    if (state.parent_id) params.set('parent_id', state.parent_id);

    fetch('api.php?' + params.toString())
        .then(res => res.json())
        .then(json => {
            if (!json.success) {
                showAlert('danger', json.message || 'Failed to load data.');
                return;
            }
            renderGroups(json.groups);
            renderSummary(json.totalGroups, json.groups);
            renderPagination(json.page, json.totalPages);
            updateSelectionBar();
        })
        .catch(err => showAlert('danger', 'Request failed: ' + err));
}

// =====================================================================
// Rendering
// =====================================================================
function renderGroups(groups) {
    if (!groups.length) {
        els.groupsContainer.innerHTML = `<div class="empty-state">No revisions match this filter.</div>`;
        return;
    }

    els.groupsContainer.innerHTML = groups.map(groupHtml).join('');

    document.querySelectorAll('.group').forEach(group => {
        group.querySelector('.group-row').addEventListener('click', function (e) {
            if (e.target.closest('.group-select-all')) return;
            group.classList.toggle('open');
        });
    });

    document.querySelectorAll('.group-select-all').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', function () {
            const group = this.closest('.group');
            group.querySelectorAll('.row-checkbox').forEach(rowCb => {
                rowCb.checked = this.checked;
                rowCb.closest('.rev-row').classList.toggle('selected', this.checked);
            });
            updateSelectionBar();
        });
    });

    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', function () {
            this.closest('.rev-row').classList.toggle('selected', this.checked);
            syncGroupCheckbox(this.closest('.group'));
            updateSelectionBar();
        });
    });

    document.querySelectorAll('.single-delete-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openConfirm([this.dataset.id]);
        });
    });
}

function groupHtml(group) {
    const statusClass = 'tag-status-' + (group.post_status || '').toLowerCase();
    const ticks = buildTicks(group.revisions);

    return `
    <div class="group" data-post-id="${group.post_id}">
        <div class="group-row">
            <input type="checkbox" class="group-select-all" title="Select all revisions of this post">
            <div class="group-name">
                <span class="name">${escapeHtml(group.post_name || '(no slug)')}</span>
                <span class="id">#${group.post_id}</span>
            </div>
            <div class="tags">
                <span class="tag">${escapeHtml(group.post_type || '&mdash;')}</span>
                <span class="tag ${statusClass}">${escapeHtml(group.post_status || '&mdash;')}</span>
            </div>
            <div class="tick-strip" title="${group.revision_count} revision(s) &middot; amber = has meta">${ticks}</div>
            <span class="col-count">${group.revision_count}</span>
            <span class="col-meta ${group.total_meta > 0 ? 'has-meta' : ''}">${group.total_meta}</span>
            <span class="col-date">${escapeHtml(group.last_revision || '')}</span>
            <button class="chevron" aria-label="Toggle revisions"><i class="bi bi-chevron-right"></i></button>
        </div>
        <div class="group-panel">
            <div class="protected-note"><i class="bi bi-shield-lock"></i> the ${PROTECTED_COUNT} most recent revisions are kept and can't be selected for deletion</div>
            ${group.revisions.map((rev, idx) => revHtml(rev, idx)).join('')}
        </div>
    </div>`;
}

function revHtml(rev, idx) {
    const protectedRev = idx < PROTECTED_COUNT;

    const checkboxCell = protectedRev
        ? `<span class="protected-slot" title="Kept — one of the ${PROTECTED_COUNT} most recent revisions"><i class="bi bi-shield-lock"></i></span>`
        : `<input type="checkbox" class="row-checkbox" value="${rev.revision_id}">`;

    const deleteCell = protectedRev
        ? `<span class="protected-slot"></span>`
        : `<button class="single-delete-btn" data-id="${rev.revision_id}" title="Delete this revision" aria-label="Delete this revision">
               <i class="bi bi-trash3"></i>
           </button>`;

    return `
    <div class="rev-row ${protectedRev ? 'protected' : ''}" data-revision-id="${rev.revision_id}" data-meta-count="${rev.meta_count}">
        ${checkboxCell}
        <span class="rev-id mono">#${rev.revision_id}</span>
        <span class="rev-title">${escapeHtml(rev.post_title || '')}</span>
        <span class="rev-date">${escapeHtml(rev.post_date)}</span>
        <span class="rev-modified">${escapeHtml(rev.post_modified)}</span>
        <span class="tag">${escapeHtml(rev.post_status)}</span>
        <span class="col-meta ${rev.meta_count > 0 ? 'has-meta' : ''}">${rev.meta_count}</span>
        ${deleteCell}
    </div>`;
}

function buildTicks(revisions) {
    const shown = revisions.slice(0, MAX_TICKS);
    const overflow = revisions.length - shown.length;
    let html = shown.map(r => `<span class="tick ${r.meta_count > 0 ? 'has-meta' : ''}"></span>`).join('');
    if (overflow > 0) html += `<span class="tick-overflow">+${overflow}</span>`;
    return html;
}

function syncGroupCheckbox(group) {
    if (!group) return;
    const boxes = group.querySelectorAll('.row-checkbox');
    const checked = group.querySelectorAll('.row-checkbox:checked');
    const groupCb = group.querySelector('.group-select-all');
    groupCb.checked = boxes.length > 0 && checked.length === boxes.length;
    groupCb.indeterminate = checked.length > 0 && checked.length < boxes.length;
}

function setAllGroups(open) {
    document.querySelectorAll('.group').forEach(g => g.classList.toggle('open', open));
}

function renderSummary(totalGroups, groups) {
    pageStats.totalGroups = totalGroups;
    pageStats.revisionsOnPage = groups.reduce((s, g) => s + g.revision_count, 0);
    pageStats.metaOnPage = groups.reduce((s, g) => s + g.total_meta, 0);
    renderSummaryFromStats();
}

function renderSummaryFromStats() {
    els.summary.textContent = `${pageStats.totalGroups.toLocaleString()} posts · ${pageStats.revisionsOnPage.toLocaleString()} revisions · ${pageStats.metaOnPage.toLocaleString()} meta rows (this page)`;
}

function renderPagination(page, totalPages) {
    if (totalPages <= 1) { els.pagination.innerHTML = ''; return; }
    els.pagination.innerHTML = `
        <button class="btn-ghost" id="prevPageBtn" ${page <= 1 ? 'disabled' : ''}>&laquo; prev</button>
        <span>page ${page} / ${totalPages}</span>
        <button class="btn-ghost" id="nextPageBtn" ${page >= totalPages ? 'disabled' : ''}>next &raquo;</button>
    `;
    document.getElementById('prevPageBtn')?.addEventListener('click', () => { if (state.page > 1) { state.page--; loadData(); } });
    document.getElementById('nextPageBtn')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; loadData(); } });
}

// =====================================================================
// Selection bar
// =====================================================================
function updateSelectionBar() {
    const checked = document.querySelectorAll('.row-checkbox:checked');
    if (checked.length === 0) {
        els.selectionBar.classList.remove('visible');
        return;
    }
    let totalMeta = 0;
    checked.forEach(cb => { totalMeta += parseInt(cb.closest('.rev-row').dataset.metaCount, 10) || 0; });
    els.selectionText.textContent = `${checked.length} revision${checked.length === 1 ? '' : 's'} selected · ${totalMeta} meta row${totalMeta === 1 ? '' : 's'}`;
    els.selectionBar.classList.add('visible');
}

// =====================================================================
// Confirm modal + delete
// =====================================================================
function openConfirm(ids) {
    idsToDelete = ids;
    let totalMeta = 0;
    const rows = ids.map(id => {
        const row = document.querySelector(`.rev-row[data-revision-id="${id}"]`);
        const metaCount = row ? (parseInt(row.dataset.metaCount, 10) || 0) : 0;
        totalMeta += metaCount;
        return `<li>revision #${id} &mdash; ${metaCount} meta row(s)</li>`;
    });

    els.modalBody.innerHTML = `
        <p>You are about to permanently delete <strong>${ids.length}</strong> revision(s)
           and <strong>${totalMeta}</strong> associated <code>wp_postmeta</code> row(s).</p>
        <div class="modal-warning">This action cannot be undone.</div>
        <ul class="modal-list">${rows.join('')}</ul>
    `;
    openModal();
}

function openModal() { els.modal.classList.add('open'); els.modal.setAttribute('aria-hidden', 'false'); }
function closeModal() { els.modal.classList.remove('open'); els.modal.setAttribute('aria-hidden', 'true'); }

function doDelete() {
    els.confirmDeleteBtn.disabled = true;
    els.confirmDeleteBtn.textContent = 'Deleting…';

    const formData = new FormData();
    formData.append('action', 'delete_revisions');
    idsToDelete.forEach(id => formData.append('ids[]', id));

    fetch('api.php', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(json => {
            closeModal();
            if (json.success) {
                removeDeletedRows(json.deleted_ids || idsToDelete);
                let msg = `Deleted ${json.deleted_posts} revision(s) and ${json.deleted_meta} meta row(s).`;
                if (json.protected_skipped) msg += ` ${json.protected_skipped} were protected and kept.`;
                if (json.skipped) msg += ` Skipped ${json.skipped} invalid id(s).`;
                showAlert('success', msg);
            } else {
                showAlert('danger', json.message || 'Delete failed.');
            }
        })
        .catch(err => showAlert('danger', 'Request failed: ' + err))
        .finally(() => {
            els.confirmDeleteBtn.disabled = false;
            els.confirmDeleteBtn.textContent = 'Delete permanently';
        });
}

// Remove exactly the rows that were deleted, update each affected group's
// counters and tick-strip in place, and drop groups that are now empty —
// all without refetching or reloading the page.
function removeDeletedRows(deletedIds) {
    let deltaMeta = 0;
    const affectedGroups = new Set();

    deletedIds.forEach(id => {
        const row = document.querySelector(`.rev-row[data-revision-id="${id}"]`);
        if (!row) return;
        deltaMeta += parseInt(row.dataset.metaCount, 10) || 0;
        const group = row.closest('.group');
        if (group) affectedGroups.add(group);
        row.remove();
    });

    let removedGroups = 0;
    affectedGroups.forEach(group => {
        const remaining = group.querySelectorAll('.rev-row');
        if (remaining.length === 0) {
            group.remove();
            removedGroups++;
        } else {
            updateGroupHeader(group, remaining);
        }
    });

    pageStats.revisionsOnPage = Math.max(0, pageStats.revisionsOnPage - deletedIds.length);
    pageStats.metaOnPage = Math.max(0, pageStats.metaOnPage - deltaMeta);
    pageStats.totalGroups = Math.max(0, pageStats.totalGroups - removedGroups);
    renderSummaryFromStats();

    if (!els.groupsContainer.querySelector('.group')) {
        els.groupsContainer.innerHTML = `<div class="empty-state">No revisions match this filter.</div>`;
    }

    updateSelectionBar();
}

function updateGroupHeader(group, remainingRows) {
    let revCount = 0;
    let metaCount = 0;
    remainingRows.forEach(row => {
        revCount++;
        metaCount += parseInt(row.dataset.metaCount, 10) || 0;
    });

    const rowsArr = Array.from(remainingRows).slice(0, MAX_TICKS);
    let ticksHtml = rowsArr.map(row => `<span class="tick ${(parseInt(row.dataset.metaCount, 10) || 0) > 0 ? 'has-meta' : ''}"></span>`).join('');
    const overflow = remainingRows.length - rowsArr.length;
    if (overflow > 0) ticksHtml += `<span class="tick-overflow">+${overflow}</span>`;

    group.querySelector('.col-count').textContent = revCount;
    const metaEl = group.querySelector('.col-meta');
    metaEl.textContent = metaCount;
    metaEl.classList.toggle('has-meta', metaCount > 0);
    group.querySelector('.tick-strip').innerHTML = ticksHtml;
}

function showAlert(type, msg) {
    els.alertContainer.innerHTML = `
        <div class="alert alert-${type}">
            <span>${msg}</span>
            <button type="button" aria-label="Dismiss">&times;</button>
        </div>`;
    els.alertContainer.querySelector('button').addEventListener('click', () => { els.alertContainer.innerHTML = ''; });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}