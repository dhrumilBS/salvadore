/* ══════════════════════════ Bulk URL Update tab ══════════════════════════
 * Paste any mix of slugs / site-relative paths / full permalinks (5, 10,
 * 100+, comma- and/or newline-separated), resolve each to a real post via
 * api/bulk_find_posts.php, then apply one status to whichever of the
 * matched posts are checked via api/bulk_update_status.php. Nothing is
 * written until the user picks a status, selects rows and confirms -
 * same "ask first" convention as the Content tab's save flow. */

let bulkMatched = [];
let bulkUnmatched = [];
let bulkSelected = new Set();

function renderBulkTable() {
    const tbody = document.getElementById('bulkTableBody');
    if (!bulkMatched.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="state-msg">No posts matched.</td></tr>';
        return;
    }
    tbody.innerHTML = bulkMatched.map(r => `
        <tr>
            <td><input type="checkbox" class="bulk-row-cb" data-id="${r.id}"${bulkSelected.has(r.id) ? ' checked' : ''}></td>
            <td class="mono">${r.id}</td>
            <td><span class="badge badge-neutral">${escapeHtml(r.post_type)}</span></td>
            <td>${escapeHtml(r.title)}</td>
            <td class="mono">${escapeHtml(r.slug)}</td>
            <td class="url-col">${urlCellHtml(r.permalink)}</td>
            <td>${statusBadge(r.status)}</td>
            <td><span class="truncate" title="${escapeHtml(r.matched_input)}">${escapeHtml(r.matched_input)}</span></td>
        </tr>`).join('');
}

function updateBulkApplyState() {
    document.getElementById('bulkApplyBtn').disabled = bulkSelected.size === 0;
    document.getElementById('bulkSelectAll').checked = bulkMatched.length > 0 && bulkSelected.size === bulkMatched.length;
}

function renderBulkResults() {
    document.getElementById('bulkResultsPanel').style.display = '';
    document.getElementById('bulkMatchedCount').textContent = bulkMatched.length;
    document.getElementById('bulkUnmatchedCount').textContent = bulkUnmatched.length;

    bulkSelected = new Set(bulkMatched.map(r => r.id));
    renderBulkTable();
    updateBulkApplyState();

    const unmatchedWrap = document.getElementById('bulkUnmatchedWrap');
    unmatchedWrap.style.display = bulkUnmatched.length ? '' : 'none';
    document.getElementById('bulkUnmatchedList').textContent = bulkUnmatched.join('\n');
}

function runBulkSearch() {
    const raw = document.getElementById('bulkUrlsInput').value;
    if (!raw.trim()) {
        toast('Paste at least one slug or URL first', 'err');
        return;
    }

    const btn = document.getElementById('bulkSearchBtn');
    btn.disabled = true;
    btn.textContent = 'Searching…';

    fetch('api/bulk_find_posts.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ urls: raw }),
    })
        .then(r => r.json())
        .then(json => {
            if (!json.success) {
                toast(json.msg || 'Search failed', 'err');
                bulkMatched = [];
                bulkUnmatched = [];
                document.getElementById('bulkResultsPanel').style.display = 'none';
                return;
            }
            bulkMatched = json.matched;
            bulkUnmatched = json.unmatched;
            renderBulkResults();
            toast(`Matched ${bulkMatched.length} of ${json.total_input} pasted`, bulkUnmatched.length ? '' : 'ok');
        })
        .catch(err => {
            console.error(err);
            toast('Search failed — check the console/network tab', 'err');
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = 'Search';
        });
}

function applyBulkStatusUpdate() {
    const ids = Array.from(bulkSelected);
    if (!ids.length) return;

    const status = document.getElementById('bulkStatusSelect').value;
    const preview = bulkMatched
        .filter(r => bulkSelected.has(r.id))
        .slice(0, 8)
        .map(r => `• #${r.id} ${truncate(r.title, 50)} (${r.status} → ${status})`)
        .join('\n');
    const more = ids.length > 8 ? `\n…and ${ids.length - 8} more post(s)` : '';
    const ok = confirm(`Set status to "${status}" for ${ids.length} post${ids.length === 1 ? '' : 's'}?\n\n${preview}${more}`);
    if (!ok) return;

    // Captured before the write lands, so "just trashed" means posts that
    // were NOT already trash and are about to become trash.
    const newlyTrashed = status === 'trash'
        ? bulkMatched.filter(r => bulkSelected.has(r.id) && r.status !== 'trash')
        : [];

    const btn = document.getElementById('bulkApplyBtn');
    btn.disabled = true;
    btn.textContent = 'Updating…';

    fetch('api/bulk_update_status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ids: ids.join(','), status }),
    })
        .then(r => r.json())
        .then(async json => {
            if (!json.success) {
                toast(json.msg || 'Update failed', 'err');
                return;
            }
            bulkMatched.forEach(r => {
                if (bulkSelected.has(r.id)) r.status = status;
            });
            renderBulkTable();
            toast(`Updated ${json.updated} post${json.updated === 1 ? '' : 's'} to "${status}"`, 'ok');
            onPostsChanged();

            if (newlyTrashed.length) {
                await offerBulkTrashRedirects(newlyTrashed);
            }
        })
        .catch(err => {
            console.error(err);
            toast('Update failed — check the console/network tab', 'err');
        })
        .finally(() => {
            updateBulkApplyState();
            btn.textContent = 'Update status for selected';
        });
}

function bindBulkTab() {
    document.getElementById('bulkSearchBtn').addEventListener('click', runBulkSearch);

    document.getElementById('bulkClearBtn').addEventListener('click', () => {
        document.getElementById('bulkUrlsInput').value = '';
        bulkMatched = [];
        bulkUnmatched = [];
        bulkSelected = new Set();
        document.getElementById('bulkResultsPanel').style.display = 'none';
    });

    document.getElementById('bulkTableBody').addEventListener('change', e => {
        const cb = e.target.closest('.bulk-row-cb');
        if (!cb) return;
        const id = parseInt(cb.dataset.id, 10);
        if (cb.checked) bulkSelected.add(id); else bulkSelected.delete(id);
        updateBulkApplyState();
    });

    document.getElementById('bulkSelectAll').addEventListener('change', e => {
        bulkSelected = e.target.checked ? new Set(bulkMatched.map(r => r.id)) : new Set();
        renderBulkTable();
        updateBulkApplyState();
    });

    document.getElementById('bulkApplyBtn').addEventListener('click', applyBulkStatusUpdate);
}
