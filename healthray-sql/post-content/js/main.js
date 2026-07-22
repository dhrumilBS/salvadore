/* ─────────────────────────────────────────────
   Link Checker - main.js  (v2)
   ───────────────────────────────────────────── */

const API = 'api.php';
const CONCURRENCY = 5;

/* ── State ─────────────────────────────────── */
const state = {
    links: [],      // flat array from API
    groups: {},      // { postId: { title, links[] } }  ← built on load
    checked: {},      // { url: { status_code, is_redirect, redirect_url } }
    filter: 'all',   // all | ok | redirect | error | pending
    search: '',
    selected: new Set(), // "postId||url"
    collapsed: new Set(), // collapsed post IDs
    isLoading: false,
    isChecking: false,
    checkProgress: 0,
    checkTotal: 0,
};

/* ── DOM refs ───────────────────────────────── */
const $tbody = document.getElementById('tbody');
const $bulkBar = document.getElementById('bulk-bar');
const $bulkCount = document.getElementById('bulk-count');
const $bulkNewUrl = document.getElementById('bulk-new-url');
const $progressWrap = document.getElementById('progress-wrap');
const $progressFill = document.getElementById('progress-fill');
const $progressText = document.getElementById('progress-text');
const $pagination = document.getElementById('pagination');
const $selectAll = document.getElementById('select-all');
const $toast = document.getElementById('toast');
const $modal = document.getElementById('edit-modal');
const $modalOldUrl = document.getElementById('modal-old-url');
const $modalNewUrl = document.getElementById('modal-new-url');
const $modalPostId = document.getElementById('modal-post-id');

/* ── Toast ──────────────────────────────────── */
function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast-item toast-${type}`;
    el.textContent = msg;
    $toast.appendChild(el);
    setTimeout(() => el.remove(), 3800);
}

/* ── Load links from API ────────────────────── */
async function loadLinks() {
    if (state.isLoading) return;
    state.isLoading = true;
    setTableLoading('Loading posts…');

    const page = document.getElementById('inp-page').value || 1;
    const perPage = document.getElementById('inp-perpage').value || 50;

    try {
        const res = await fetch(`${API}?action=get_links&page=${page}&perPage=${perPage}`);
        const data = await res.json();
        if (data.status !== 'success') { showToast('API error: ' + data.message, 'error'); return; }

        state.links = data.links;
        state.checked = {};
        state.selected.clear();
        state.collapsed.clear();

        document.getElementById('site-url-label').textContent = data.site_url || '';

        buildGroups();
        updateStats();
        renderTable();
        renderPagination(data.page, data.total_pages);
        showToast(`Loaded ${data.link_count} internal links from page ${data.page}`, 'success');
    } catch (e) {
        showToast('Failed to load: ' + e.message, 'error');
    } finally {
        state.isLoading = false;
    }
}

/* ── Build group map  { postId → { title, links[] } } ── */
function buildGroups() {
    state.groups = {};
    for (const link of state.links) {
        if (!state.groups[link.post_id]) {
            state.groups[link.post_id] = { title: link.post_title, links: [] };
        }
        state.groups[link.post_id].links.push(link);
    }
}

/* ── Check ALL links ────────────────────────── */
async function checkAllLinks() {
    if (state.isChecking) return;
    const unchecked = state.links.filter(l => !state.checked[l.url]);
    if (!unchecked.length) { showToast('All links already checked', 'info'); return; }

    state.isChecking = true;
    state.checkTotal = unchecked.length;
    state.checkProgress = 0;
    $progressWrap.classList.add('visible');
    updateProgress();

    for (let i = 0; i < unchecked.length; i += CONCURRENCY) {
        const batch = unchecked.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(l => checkSingleUrl(l.url)));
        state.checkProgress += batch.length;
        updateProgress();
        updateStats();
        renderTable();       // live update while checking
    }

    state.isChecking = false;
    $progressWrap.classList.remove('visible');
    showToast('All links checked!', 'success');
}

/* ── Check one URL ──────────────────────────── */
async function checkSingleUrl(url) {
    try {
        const res = await fetch(`${API}?action=check_status&url=${encodeURIComponent(url)}`);
        const data = await res.json();
        state.checked[url] = data;
    } catch {
        state.checked[url] = { status_code: 0, is_redirect: false, redirect_url: null };
    }
}

/* ── Check single row button ────────────────── */
async function checkRowLink(url, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin spin-dark"></span>';
    await checkSingleUrl(url);
    updateStats();
    // Only repaint that one row, not whole table
    repaintLinkRow(url);
    updateStats();
    btn.disabled = false;
}

/* ── Repaint ONE link row in-place ──────────── */
function repaintLinkRow(url) {
    const row = document.querySelector(`tr[data-url="${CSS.escape(url)}"]`);
    if (!row) { renderTable(); return; }

    const postId = row.dataset.postId;
    const link = state.links.find(l => l.url === url && String(l.post_id) === String(postId));
    if (!link) return;

    const c = state.checked[url];
    const key = `${link.post_id}||${link.url}`;
    const sel = state.selected.has(key);

    row.className = `link-row${sel ? ' selected' : ''}`;
    row.innerHTML = linkRowInner(link, c, key, sel);
    attachRowCheckbox(row);
}

/* ── Progress bar ───────────────────────────── */
function updateProgress() {
    const pct = state.checkTotal > 0 ? Math.round((state.checkProgress / state.checkTotal) * 100) : 0;
    $progressFill.style.width = pct + '%';
    $progressText.textContent = `Checking… ${state.checkProgress} / ${state.checkTotal} (${pct}%)`;
}

/* ── Stats ──────────────────────────────────── */
function updateStats() {
    let ok = 0, rd = 0, err = 0, pend = 0;
    for (const link of state.links) {
        const c = state.checked[link.url];
        if (!c) pend++;
        else if (c.status_code >= 200 && c.status_code < 300) ok++;
        else if (c.status_code >= 300 && c.status_code < 400) rd++;
        else err++;
    }
    document.getElementById('stat-total').textContent = state.links.length;
    document.getElementById('stat-ok').textContent = ok;
    document.getElementById('stat-rd').textContent = rd;
    document.getElementById('stat-err').textContent = err;
    document.getElementById('stat-pend').textContent = pend;

    document.querySelectorAll('.ftab').forEach(btn => {
        const f = btn.dataset.filter;
        const fc = btn.querySelector('.fc');
        if (!fc) return;
        const map = { all: state.links.length, ok, redirect: rd, error: err, pending: pend };
        fc.textContent = map[f] ?? '';
    });
}

/* ── Filtered + grouped data ────────────────── */
function filteredGroups() {
    const search = state.search.toLowerCase();
    const result = {};

    for (const [postId, group] of Object.entries(state.groups)) {
        const links = group.links.filter(link => {
            const c = state.checked[link.url];

            if (search) {
                const hay = (link.url + link.anchor_text + link.post_title).toLowerCase();
                if (!hay.includes(search)) return false;
            }

            if (state.filter === 'all') return true;
            if (!c) return state.filter === 'pending';
            if (state.filter === 'ok') return c.status_code >= 200 && c.status_code < 300;
            if (state.filter === 'redirect') return c.status_code >= 300 && c.status_code < 400;
            if (state.filter === 'error') return c.status_code === 0 || c.status_code >= 400;
            return true;
        });

        if (links.length) result[postId] = { title: group.title, links };
    }
    return result;
}

/* ── Render full table ──────────────────────── */
function renderTable() {
    const groups = filteredGroups();

    if (!Object.keys(groups).length) {
        $tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">🔗</div><p>No links match this filter.</p></div></td></tr>`;
        updateBulkBar();
        return;
    }

    let html = '';
    for (const [postId, group] of Object.entries(groups)) {
        const collapsed = state.collapsed.has(postId);
        const allKeys = group.links.map(l => `${postId}||${l.url}`);
        const allSel = allKeys.every(k => state.selected.has(k));
        const redirCount = group.links.filter(l => state.checked[l.url]?.is_redirect).length;

        // Group header row
        html += `<tr class="group-row" data-post-id="${postId}">
          <td colspan="7">
            <span class="group-toggle" onclick="toggleGroup('${postId}')">${collapsed ? '▶' : '▼'}</span>
            <strong>${esc(group.title)}</strong>
            <span class="group-post-id">#${postId}</span>
            <span class="group-link-count">${group.links.length} link${group.links.length !== 1 ? 's' : ''}${redirCount ? ` · <span style="color:#f59e0b">${redirCount} redirect${redirCount !== 1 ? 's' : ''}</span>` : ''}</span>
            <span style="float:right;display:flex;gap:6px;align-items:center">
              ${redirCount ? `<button class="btn btn-warning btn-sm" onclick="fixGroupRedirects('${postId}')">Fix ${redirCount} Redirect${redirCount !== 1 ? 's' : ''}</button>` : ''}
              <label style="font-size:11px;color:#64748b;cursor:pointer;display:flex;gap:4px;align-items:center">
                <input type="checkbox" class="group-check" data-post-id="${postId}" ${allSel ? 'checked' : ''}> Select all
              </label>
            </span>
          </td>
        </tr>`;

        if (!collapsed) {
            for (const link of group.links) {
                const c = state.checked[link.url];
                const key = `${postId}||${link.url}`;
                const sel = state.selected.has(key);
                html += `<tr class="link-row${sel ? ' selected' : ''}" data-url="${escAttr(link.url)}" data-post-id="${postId}">
                  ${linkRowInner(link, c, key, sel)}
                </tr>`;
            }
        }
    }

    $tbody.innerHTML = html;

    // Attach checkbox listeners
    document.querySelectorAll('.row-check').forEach(cb => attachRowCheckbox(cb.closest('tr')));
    document.querySelectorAll('.group-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const pid = cb.dataset.postId;
            const group = filteredGroups()[pid];
            if (!group) return;
            group.links.forEach(l => {
                const k = `${pid}||${l.url}`;
                cb.checked ? state.selected.add(k) : state.selected.delete(k);
            });
            renderTable();
            updateBulkBar();
        });
    });

    updateBulkBar();
}

/* ── Inner cells for a link row ─────────────── */
function linkRowInner(link, c, key, sel) {
    const badge = statusBadge(c);
    const redir = c?.is_redirect
        ? `<div class="redir-target" title="${escAttr(c.redirect_url || '')}">→ ${trunc(c.redirect_url || '', 55)}</div>`
        : '';

    return `
      <td style="width:36px"><input type="checkbox" class="row-check" data-key="${escAttr(key)}" ${sel ? 'checked' : ''}></td>
      <td class="hide-mob" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(link.anchor_text)}">${esc(link.anchor_text)}</td>
      <td>
        <div class="url-cell"><a href="${escAttr(link.url)}" target="_blank" rel="noopener">${trunc(link.url, 55)}</a></div>
        ${redir}
      </td>
      <td style="width:110px">${badge}</td>
      <td style="width:170px">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${!c
            ? `<button class="btn btn-ghost btn-sm" onclick="checkRowLink('${escAttr(link.url)}',this)">Check</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="checkRowLink('${escAttr(link.url)}',this)" title="Re-check">↺</button>`
        }
          ${c?.is_redirect
            ? `<button class="btn btn-warning btn-sm" onclick="fixSingleRedirect(${link.post_id},'${escAttr(link.url)}','${escAttr(c.redirect_url || '')}',this)">Fix</button>`
            : ''
        }
          <button class="btn btn-ghost btn-sm" onclick="openEditModal(${link.post_id},'${escAttr(link.url)}','')">Edit</button>
        </div>
      </td>`;
}

/* ── Attach checkbox listener to a row ──────── */
function attachRowCheckbox(row) {
    const cb = row.querySelector('.row-check');
    if (!cb) return;
    cb.addEventListener('change', () => {
        const k = cb.dataset.key;
        cb.checked ? state.selected.add(k) : state.selected.delete(k);
        row.classList.toggle('selected', cb.checked);
        updateBulkBar();
    });
}

/* ── Toggle collapse/expand post group ──────── */
function toggleGroup(postId) {
    if (state.collapsed.has(postId)) state.collapsed.delete(postId);
    else state.collapsed.add(postId);
    renderTable();
}

/* ── Fix redirects for one post group ───────── */
async function fixGroupRedirects(postId) {
    const group = state.groups[postId];
    if (!group) return;

    const updates = group.links
        .filter(l => state.checked[l.url]?.is_redirect && state.checked[l.url]?.redirect_url)
        .map(l => ({ post_id: parseInt(postId, 10), old_url: l.url, new_url: state.checked[l.url].redirect_url }));

    if (!updates.length) { showToast('No redirect links in this post', 'error'); return; }
    if (!confirm(`Fix ${updates.length} redirect(s) in "${group.title}"?`)) return;

    await runBulkUpdate(updates, true);
}

/* ── Fix single redirect inline (no page reload) */
async function fixSingleRedirect(postId, oldUrl, newUrl, btn) {
    if (!newUrl) { showToast('No redirect target found - check link first', 'error'); return; }
    if (!confirm(`Replace:\n${oldUrl}\n\nWith:\n${newUrl}`)) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spin spin-dark"></span>';

    try {
        const res = await fetch(`${API}?action=update_link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: postId, old_url: oldUrl, new_url: newUrl }),
        });
        const data = await res.json();

        if (data.status === 'success' || data.status === 'no_change') {
            // Update in-memory state: swap URL, reset check status
            updateLinkInState(postId, oldUrl, newUrl);
            showToast(data.status === 'success' ? 'Link updated!' : 'No change in DB', 'success');
            // Re-check only the new URL, then repaint that row
            await checkSingleUrl(newUrl);
            updateStats();
            renderTable();
        } else {
            showToast('Error: ' + data.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Fix';
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Fix';
    }
}

/* ── Bulk update helper (used by multiple callers) */
async function runBulkUpdate(updates, recheckAfter = true) {
    try {
        const res = await fetch(`${API}?action=bulk_update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        showToast(`Updated ${data.updated} of ${data.total} post(s)`, 'success');

        if (recheckAfter) {
            // Swap URLs in memory, re-check only the new URLs
            for (const u of updates) {
                if (data.results?.find(r => r.post_id === u.post_id && r.status === 'updated')) {
                    updateLinkInState(u.post_id, u.old_url, u.new_url);
                }
            }
            const newUrls = [...new Set(updates.map(u => u.new_url))];
            showToast(`Re-checking ${newUrls.length} updated URL(s)…`, 'info');
            await Promise.all(newUrls.map(u => checkSingleUrl(u)));
        }

        state.selected.clear();
        buildGroups();
        updateStats();
        renderTable();
        return data;
    } catch (e) {
        showToast('Bulk update failed: ' + e.message, 'error');
    }
}

/* ── Swap old URL → new URL in state.links ──── */
function updateLinkInState(postId, oldUrl, newUrl) {
    for (const link of state.links) {
        if (String(link.post_id) === String(postId) && link.url === oldUrl) {
            link.url = newUrl;
            link.original = newUrl;
            // Carry over old check result temporarily until re-check completes
            if (state.checked[oldUrl]) {
                state.checked[newUrl] = state.checked[oldUrl];
                delete state.checked[oldUrl];
            }
        }
    }
}

/* ── Status badge HTML ──────────────────────── */
function statusBadge(c) {
    if (!c) return `<span class="sbadge s-pend">Pending</span>`;
    const code = c.status_code;
    if (code === 0) return `<span class="sbadge s-4xx">Timeout</span>`;
    if (code >= 200 && code < 300) return `<span class="sbadge s-200">✓ ${code}</span>`;
    if (code >= 300 && code < 400) return `<span class="sbadge s-3xx">⇒ ${code}</span>`;
    return `<span class="sbadge s-4xx">✗ ${code}</span>`;
}

/* ── Bulk bar ───────────────────────────────── */
function updateBulkBar() {
    const n = state.selected.size;
    if (n > 0) {
        $bulkBar.classList.add('show');
        $bulkCount.textContent = `${n} link${n !== 1 ? 's' : ''} selected`;
        // Count how many selected have redirect targets
        const redirCount = [...state.selected].filter(key => {
            const [, url] = key.split('||');
            return state.checked[url]?.is_redirect && state.checked[url]?.redirect_url;
        }).length;
        const btn = document.getElementById('btn-bulk-redir');
        btn.textContent = redirCount ? `⇒ Fix ${redirCount} Redirect${redirCount !== 1 ? 's' : ''}` : '⇒ Fix Redirects';
        btn.disabled = redirCount === 0;
    } else {
        $bulkBar.classList.remove('show');
    }
}

/* ── Bulk fix selected redirects ────────────── */
async function bulkFixRedirects() {
    const updates = [];
    for (const key of state.selected) {
        const [postIdStr, oldUrl] = key.split('||');
        const c = state.checked[oldUrl];
        if (!c?.is_redirect || !c.redirect_url) continue;
        updates.push({ post_id: parseInt(postIdStr, 10), old_url: oldUrl, new_url: c.redirect_url });
    }
    if (!updates.length) { showToast('No redirect links in selection (run Check first)', 'error'); return; }
    if (!confirm(`Fix ${updates.length} redirect URL(s) → replace with their target?`)) return;

    const btn = document.getElementById('btn-bulk-redir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Fixing…';
    await runBulkUpdate(updates, true);
    btn.disabled = false;
    btn.textContent = '⇒ Fix Redirects';
}

/* ── Bulk apply custom URL ──────────────────── */
async function bulkApplyCustom() {
    const newUrl = $bulkNewUrl.value.trim();
    if (!newUrl) { showToast('Enter a new URL first', 'error'); return; }
    if (!state.selected.size) { showToast('Select links first', 'error'); return; }
    if (!confirm(`Replace ${state.selected.size} selected URL(s) with:\n${newUrl}`)) return;

    const updates = [...state.selected].map(key => {
        const [postIdStr, oldUrl] = key.split('||');
        return { post_id: parseInt(postIdStr, 10), old_url: oldUrl, new_url: newUrl };
    });

    const btn = document.getElementById('btn-bulk-custom');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Applying…';
    await runBulkUpdate(updates, true);
    $bulkNewUrl.value = '';
    btn.disabled = false;
    btn.textContent = 'Apply';
}

/* ── Pagination ─────────────────────────────── */
function renderPagination(current, total) {
    if (total <= 1) { $pagination.innerHTML = ''; return; }
    let html = `<button class="page-btn" onclick="changePage(${current - 1})" ${current === 1 ? 'disabled' : ''}>‹</button>`;
    const s = Math.max(1, current - 2), e = Math.min(total, current + 2);
    if (s > 1) html += `<button class="page-btn" onclick="changePage(1)">1</button>${s > 2 ? '<span style="padding:0 4px">…</span>' : ''}`;
    for (let p = s; p <= e; p++) html += `<button class="page-btn${p === current ? ' active' : ''}" onclick="changePage(${p})">${p}</button>`;
    if (e < total) html += `${e < total - 1 ? '<span style="padding:0 4px">…</span>' : ''}<button class="page-btn" onclick="changePage(${total})">${total}</button>`;
    html += `<button class="page-btn" onclick="changePage(${current + 1})" ${current === total ? 'disabled' : ''}>›</button>`;
    $pagination.innerHTML = html;
}
function changePage(p) { document.getElementById('inp-page').value = p; loadLinks(); }

/* ── Select All (visible) ───────────────────── */
$selectAll.addEventListener('change', () => {
    const groups = filteredGroups();
    for (const [pid, group] of Object.entries(groups)) {
        group.links.forEach(l => {
            const k = `${pid}||${l.url}`;
            $selectAll.checked ? state.selected.add(k) : state.selected.delete(k);
        });
    }
    renderTable();
    updateBulkBar();
});

/* ── Modal (single edit) ────────────────────── */
function openEditModal(postId, oldUrl, newUrl) {
    $modalPostId.value = postId;
    $modalOldUrl.value = oldUrl;
    $modalNewUrl.value = newUrl;
    $modal.classList.add('open');
    setTimeout(() => $modalNewUrl.focus(), 80);
}
function closeModal() { $modal.classList.remove('open'); }

async function saveModal() {
    const postId = parseInt($modalPostId.value, 10);
    const oldUrl = $modalOldUrl.value.trim();
    const newUrl = $modalNewUrl.value.trim();
    if (!newUrl) { showToast('Enter a new URL', 'error'); return; }

    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Saving…';

    try {
        const res = await fetch(`${API}?action=update_link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: postId, old_url: oldUrl, new_url: newUrl }),
        });
        const data = await res.json();

        if (data.status === 'success') {
            closeModal();
            updateLinkInState(postId, oldUrl, newUrl);
            showToast('Saved! Re-checking new URL…', 'success');
            // Re-check only the new URL - no full page reload
            await checkSingleUrl(newUrl);
            buildGroups();
            updateStats();
            renderTable();
        } else if (data.status === 'no_change') {
            showToast('URL not found in post content', 'info');
        } else {
            showToast('Error: ' + data.message, 'error');
        }
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

/* ── Filter tabs ────────────────────────────── */
document.querySelectorAll('.ftab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filter = btn.dataset.filter;
        renderTable();
    });
});

/* ── Search ─────────────────────────────────── */
document.getElementById('inp-search').addEventListener('input', e => {
    state.search = e.target.value;
    renderTable();
});

/* ── Close modal on backdrop ────────────────── */
$modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); });

/* ── Export CSV ─────────────────────────────── */
function exportCsv() {
    const rows = [['Post ID', 'Post Title', 'Anchor Text', 'URL', 'Status', 'Redirect Target']];
    const groups = filteredGroups();
    for (const [pid, group] of Object.entries(groups)) {
        for (const link of group.links) {
            const c = state.checked[link.url];
            rows.push([pid, group.title, link.anchor_text, link.url, c ? c.status_code : 'pending', c?.redirect_url || '']);
        }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'link-checker.csv' });
    a.click();
}

/* ── Helpers ────────────────────────────────── */
function setTableLoading(msg) {
    $tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8">${msg}</td></tr>`;
}
function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }