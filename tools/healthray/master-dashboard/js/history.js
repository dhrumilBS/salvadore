/* ══════════════════════════ History drawer ══════════════════════════
 * Every Link Fixer write (replace / fix / unlink / undo) as journaled by the
 * server for the current site (api/fixer_history.php), so the log survives
 * reloads and is the same for everyone using this tool. Any entry can be
 * undone (api/fixer_undo.php) as long as the post/FAQ field hasn't changed
 * since - the server refuses rather than overwrite a newer edit. */

let historyEntries = [];
let historyFilter = '';
const nextHistorySignal = latestOnly();

const HISTORY_LABEL = { replace: 'Updated', unlink: 'Unlinked', undo: 'Undo' };

async function refreshHistoryCount() {
    try {
        const json = await api('fixer_history.php', { params: { limit: 1 } });
        if (json.success) renderHistoryCount(json.total);
    } catch (err) { /* the badge is cosmetic */ }
}

function renderHistoryCount(n) {
    const el = document.getElementById('historyCount');
    el.textContent = fmtNum(n);
    el.classList.toggle('has-items', n > 0);
}

async function loadHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<div class="hist-empty"><span class="spinner"></span> Loading…</div>';
    try {
        const json = await api('fixer_history.php', { params: { limit: 1000 }, signal: nextHistorySignal() });
        if (!json.success) throw new Error(json.msg);
        historyEntries = json.entries;
        renderHistoryCount(json.total);
        renderHistory();
    } catch (err) {
        if (isAbort(err)) return;
        console.error(err);
        list.innerHTML = '<div class="hist-empty error">Could not load history.</div>';
    }
}

function historyMatches(e) {
    if (!historyFilter) return true;
    return `${e.post_id} ${e.title} ${e.from} ${e.to} ${e.meta_key || ''}`.toLowerCase().includes(historyFilter);
}

function renderHistory() {
    const list = document.getElementById('historyList');
    const rows = historyEntries.filter(historyMatches);
    if (!historyEntries.length) {
        list.innerHTML = '<div class="hist-empty">No link changes on this site yet.<br>Edits, fixes and unlinks made in Link Fixer are listed here — and can be undone.</div>';
        return;
    }
    if (!rows.length) {
        list.innerHTML = '<div class="hist-empty">No changes match that filter.</div>';
        return;
    }
    list.innerHTML = rows.map(e => {
        const t = Date.parse(e.t);
        const tone = e.action === 'unlink' ? 's-4xx' : e.action === 'undo' ? 's-3xx' : 's-200';
        const canUndo = !e.undone;
        return `<div class="hist-item${e.undone ? ' is-undone' : ''}">
            <div class="hist-head">
                <span class="fx-badge ${tone}">${HISTORY_LABEL[e.action] || escapeHtml(e.action)}</span>
                <span class="hist-title" title="${escapeHtml(e.title)}">#${escapeHtml(e.post_id)} · ${escapeHtml(e.title)}</span>
                <span class="hist-time" title="${escapeHtml(new Date(t).toLocaleString())}">${escapeHtml(fxTimeAgo(t))}</span>
            </div>
            <div class="hist-urls">
                <div class="cl-from">${escapeHtml(e.from || '—')}</div>
                <div class="cl-to">${e.to ? escapeHtml(e.to) : '<em>link removed — anchor text kept</em>'}</div>
            </div>
            <div class="hist-foot">
                <span>${e.source === 'faq' ? `FAQ (${escapeHtml(e.meta_key || '')})` : 'Post content'}${e.count > 1 ? ` · ${e.count} occurrences` : ''}</span>
                ${e.undone ? '<span class="hist-undone">Undone</span>'
                    : canUndo ? `<button type="button" class="btn small" data-undo="${escapeHtml(e.id)}">Undo</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function undoHistoryEntry(id, btn) {
    const e = historyEntries.find(x => x.id === id);
    if (!e) return;
    const ok = await confirmDialog({
        title: 'Undo this change?',
        message: `Puts back exactly what #${e.post_id} ${e.source === 'faq' ? `(FAQ ${e.meta_key})` : ''} held before this change. Refused if it has been edited since.`,
        changes: [{ post: `#${e.post_id} · ${truncate(e.title, 70)}`, from: e.to || '(unlinked text)', to: e.from }],
        okLabel: 'Undo change', tone: 'warn',
    });
    if (!ok) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
        const json = await api('fixer_undo.php', { method: 'POST', body: new URLSearchParams({ id }) });
        if (json.success) {
            toast('Change undone', 'ok');
            onLinksChanged();
            if (fx.loaded) markStale(['fixer']);
        } else {
            toast(json.msg || 'Undo failed', 'err');
        }
    } catch (err) {
        console.error(err);
        toast('Undo failed — network error', 'err');
    }
    loadHistory();
}

function exportHistoryCsv() {
    if (!historyEntries.length) { toast('No changes to export'); return; }
    fxDownloadCsv('link-changes', [
        ['Time', 'Site', 'Action', 'Post ID', 'Post Title', 'Source', 'Old URL', 'New URL', 'Occurrences', 'Undone'],
        ...historyEntries.filter(historyMatches).map(e => [new Date(Date.parse(e.t)).toLocaleString(), e.site, e.action, e.post_id, e.title,
            e.source === 'faq' ? `FAQ (${e.meta_key || ''})` : 'Post content', e.from, e.to, e.count || 1, e.undone ? 'yes' : '']),
    ]);
}

const isHistoryOpen = () => document.body.classList.contains('drawer-open');

function openHistory() {
    document.body.classList.add('drawer-open');
    document.getElementById('historyDrawer').setAttribute('aria-hidden', 'false');
    document.getElementById('historyClose').focus();
    loadHistory();
}

function closeHistory() {
    document.body.classList.remove('drawer-open');
    document.getElementById('historyDrawer').setAttribute('aria-hidden', 'true');
}

function bindHistory() {
    document.getElementById('historyBtn').addEventListener('click', openHistory);
    document.getElementById('historyClose').addEventListener('click', closeHistory);
    document.getElementById('drawerScrim').addEventListener('click', closeHistory);
    document.getElementById('historyCsv').addEventListener('click', exportHistoryCsv);
    document.getElementById('historyReload').addEventListener('click', loadHistory);
    document.getElementById('historySearch').addEventListener('input', debounce(e => {
        historyFilter = e.target.value.trim().toLowerCase();
        renderHistory();
    }, 150));
    document.getElementById('historyList').addEventListener('click', e => {
        const btn = e.target.closest('[data-undo]');
        if (btn) undoHistoryEntry(btn.dataset.undo, btn);
    });
}
