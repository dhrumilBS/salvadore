/* ══════════════════════════ History drawer (unified) ══════════════════════════
 * Every write made through this dashboard on the current site, newest first:
 * Content field saves, Bulk status, redirects, Menu Order, Find & Replace,
 * Link Fixer and Focus Keywords (api/activity_list.php - backups/activity-<site>.jsonl,
 * with the older Link Fixer / Find & Replace journals merged in server-side).
 *
 * Undo (api/activity_undo.php) restores each value only while it still equals
 * what the write left - anything edited since is skipped and reported. Find &
 * Replace and Link Fixer entries are undone through their own journals.
 *
 * Globals other files use (keep the names): openHistory, closeHistory,
 * isHistoryOpen, bindHistory, refreshHistoryCount. The count badge shows the
 * writes of the last 24 hours (undos not counted).
 *
 * The drawer works with the old markup too (no chips container); the new
 * markup lives in _snippets/history.html. */

const HISTORY_PAGE = 200;
const HISTORY_SOURCES = [
    ['', 'All'], ['content', 'Content'], ['bulk', 'Bulk'], ['redirects', 'Redirects'], ['menu', 'Menu Order'],
    ['replace', 'Find & Replace'], ['fixer', 'Link Fixer'], ['keywords', 'Keywords'], ['canonical', 'Canonicals'],
];
const HISTORY_SOURCE_LABEL = Object.fromEntries(HISTORY_SOURCES.filter(([k]) => k));
const HISTORY_FIELD_LABEL = {
    post_title: 'Title', post_name: 'Slug', post_status: 'Status', post_date: 'Publish date', post_date_gmt: 'Publish date (GMT)',
    menu_order: 'Menu order', post_content: 'Post content', _yoast_wpseo_title: 'Meta title', _yoast_wpseo_metadesc: 'Meta description',
    _yoast_wpseo_focuskw: 'Focus keyword', _yoast_wpseo_canonical: 'Canonical URL',
};
const HISTORY_CLIP = 220; // chars shown before "show more"

const hist = {
    entries: [],
    total: 0,
    counts: {},
    source: '',
    q: '',
    adminUrl: '',
    expanded: new Set(),  // entry ids with their diff open
    moreOpen: new Set(),  // "<entry id>:<change idx>:<side>" values shown in full
    loading: false,
};
let historyEntries = hist.entries; // kept for anything that peeked at the old global
const nextHistorySignal = latestOnly();

/* ── badge ── */
async function refreshHistoryCount() {
    try {
        const json = await api('activity_list.php', { params: { limit: 1 } });
        if (json.success) renderHistoryCount(json.recent_24h);
    } catch (err) { /* the badge is cosmetic */ }
}

function renderHistoryCount(n) {
    const el = document.getElementById('historyCount');
    if (!el) return;
    el.textContent = fmtNum(n);
    el.classList.toggle('has-items', n > 0);
    const label = `${pluralize(n, 'change')} in the last 24 hours`;
    el.title = label;
    document.getElementById('historyBtn')?.setAttribute('title', `History — every change made here on this site, with undo (h). ${label}.`);
}

// Any write anywhere in the dashboard returns activity_id - refresh the badge
// (and the open drawer) without every tab having to know about History.
(() => {
    const plainApi = api;
    const refreshSoon = debounce(() => {
        refreshHistoryCount();
        if (isHistoryOpen()) loadHistory();
    }, 400);
    // eslint-disable-next-line no-global-assign
    api = function (path, opts = {}) {
        const p = plainApi(path, opts);
        if ((opts.method || 'GET').toUpperCase() === 'POST' && path !== 'activity_undo.php') {
            p.then(json => { if (json && json.activity_id) refreshSoon(); }).catch(() => { });
        }
        return p;
    };
})();

/* ── loading ── */
async function loadHistory({ append = false } = {}) {
    const list = document.getElementById('historyList');
    if (!append) {
        list.innerHTML = '<div class="hist-empty"><span class="spinner"></span> Loading…</div>';
    }
    hist.loading = true;
    try {
        const json = await api('activity_list.php', {
            params: { source: hist.source, q: hist.q, limit: HISTORY_PAGE, offset: append ? hist.entries.length : 0 },
            signal: nextHistorySignal(),
        });
        if (!json.success) throw new Error(json.msg);
        hist.entries = append ? hist.entries.concat(json.entries) : json.entries;
        historyEntries = hist.entries;
        hist.total = json.total;
        hist.counts = json.counts_by_source || {};
        hist.adminUrl = json.admin_url || '';
        renderHistoryCount(json.recent_24h);
        renderHistoryChips();
        renderHistory();
    } catch (err) {
        if (isAbort(err)) return;
        console.error(err);
        list.innerHTML = '<div class="hist-empty error">Could not load history.</div>';
    } finally {
        hist.loading = false;
    }
}

/* ── rendering ── */
function renderHistoryChips() {
    const box = document.getElementById('historyChips');
    if (!box) return;
    const all = Object.values(hist.counts).reduce((a, b) => a + (b || 0), 0);
    box.innerHTML = HISTORY_SOURCES.map(([key, label]) => {
        const n = key ? (hist.counts[key] || 0) : all;
        const on = hist.source === key;
        return `<button type="button" class="hx-chip${on ? ' on' : ''}${!n && !on ? ' empty' : ''}" data-source="${key}" aria-pressed="${on}">
            ${key ? `<span class="hx-dot hx-src-${key}"></span>` : ''}${escapeHtml(label)}<span class="hx-chip-n">${fmtNum(n)}</span></button>`;
    }).join('');
}

function histRelTime(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function histDayLabel(t) {
    const d = new Date(t);
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(new Date()) - start(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Display text of one side of a change. */
function histValue(c, side) {
    const v = c[side];
    if (c.kind === 'redirect') {
        if (!v) return '(no redirect)';
        return Number(v.type) === 410 || Number(v.type) === 451 ? `${v.type} Gone`
            : `${v.type} → ${/^([a-z][a-z0-9+.-]*:)?\/\//i.test(v.url) ? v.url : '/' + v.url + '/'}`;
    }
    if (v === null || v === undefined) return side === 'before' ? '(did not exist)' : '(deleted)';
    if (c.kind === 'link' && v === '') return side === 'after' ? '(link removed — anchor text kept)' : '(unlinked text)';
    if (v === '') return '(empty)';
    return String(v);
}

function histChangeLabel(c) {
    if (c.kind === 'redirect') return c.format === 'regex' ? `Redirect ${c.origin} (regex)` : `Redirect /${c.origin}/`;
    const field = c.kind === 'meta' ? c.key : c.field;
    const label = HISTORY_FIELD_LABEL[field] || field || '';
    const post = c.post_id ? `#${c.post_id}` : '';
    const extra = c.kind === 'text' ? ` · ${`${fmtNum(c.count || 0)} ${c.count === 1 ? 'match' : 'matches'}`}` : c.kind === 'link' && c.count > 1 ? ` · ${c.count}×` : '';
    return [post, c.title ? truncate(c.title, 60) : '', label + extra].filter(Boolean).join(' · ');
}

function histPostLink(id) {
    const url = hist.adminUrl ? `${hist.adminUrl}post.php?post=${encodeURIComponent(id)}&action=edit` : '';
    return url
        ? `<a class="hx-post" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Edit #${escapeHtml(id)} in WordPress">#${escapeHtml(id)}</a>`
        : `<span class="hx-post">#${escapeHtml(id)}</span>`;
}

function histClip(entryId, idx, side, text) {
    const key = `${entryId}:${idx}:${side}`;
    if (text.length <= HISTORY_CLIP || hist.moreOpen.has(key)) {
        return escapeHtml(text) + (text.length > HISTORY_CLIP ? ` <button type="button" class="hx-more" data-more="${escapeHtml(key)}">show less</button>` : '');
    }
    return `${escapeHtml(text.slice(0, HISTORY_CLIP))}… <button type="button" class="hx-more" data-more="${escapeHtml(key)}">show more (${fmtNum(text.length)} chars)</button>`;
}

function histDiffHtml(e) {
    const changes = e.changes || [];
    if (!changes.length) return '<div class="hx-diff-empty">No per-field detail recorded.</div>';
    const MAX = 200;
    return changes.slice(0, MAX).map((c, i) => `<div class="hx-change">
            <div class="hx-change-label">${escapeHtml(histChangeLabel(c))}</div>
            <div class="hx-before">${histClip(e.id, i, 'b', histValue(c, 'before'))}</div>
            <div class="hx-after">${histClip(e.id, i, 'a', histValue(c, 'after'))}</div>
        </div>`).join('')
        + (changes.length > MAX ? `<div class="hx-diff-empty">…and ${fmtNum(changes.length - MAX)} more (in the CSV export)</div>` : '')
        + ((e.skipped || []).length ? `<div class="hx-skipped"><b>Skipped:</b> ${e.skipped.map(s => escapeHtml(`${s.post_id ? '#' + s.post_id + ' ' : ''}${s.field || ''}: ${s.reason}`)).join('<br>')}</div>` : '');
}

function histEntryHtml(e) {
    const t = Date.parse(e.time);
    const open = hist.expanded.has(e.id);
    const ids = e.post_ids || [];
    const nChanges = (e.changes || []).length;
    const isUndo = e.action === 'undo';
    const undone = e.undone && typeof e.undone === 'object' ? e.undone : null;
    const undoneTitle = undone ? `Undone ${undone.time ? new Date(Date.parse(undone.time)).toLocaleString() : ''}${undone.skipped ? ` · ${undone.skipped} skipped` : ''}` : '';
    return `<div class="hx-item${undone ? ' is-undone' : ''}${isUndo ? ' is-undo' : ''}" data-id="${escapeHtml(e.id)}">
        <div class="hx-head">
            <span class="hx-badge hx-src-${escapeHtml(e.source)}">${escapeHtml(HISTORY_SOURCE_LABEL[e.source] || e.source)}</span>
            ${isUndo ? '<span class="hx-badge hx-undo-badge">Undo</span>' : ''}
            <span class="hx-time" title="${escapeHtml(t ? new Date(t).toLocaleString() : e.time)}">${escapeHtml(histRelTime(t))}</span>
        </div>
        <div class="hx-summary">${escapeHtml(e.summary || e.action)}</div>
        <div class="hx-foot">
            <span class="hx-posts">${ids.slice(0, 6).map(histPostLink).join(' ')}${ids.length > 6 ? ` <span class="hx-more-ids">+${fmtNum(ids.length - 6)}</span>` : ''}</span>
            ${nChanges ? `<button type="button" class="hx-toggle" data-toggle="${escapeHtml(e.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${pluralize(nChanges, 'change')}</button>` : ''}
            ${e.migrated ? '<span class="hx-note" title="From the tab\'s own journal (before the unified History existed)">journal</span>' : ''}
            <span class="hx-actions">
                ${undone ? `<span class="hx-undone" title="${escapeHtml(undoneTitle)}">Undone</span>`
                    : e.can_undo ? `<button type="button" class="btn small" data-undo="${escapeHtml(e.id)}">Undo</button>` : ''}
            </span>
        </div>
        ${open ? `<div class="hx-diff">${histDiffHtml(e)}</div>` : ''}
    </div>`;
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (!hist.entries.length) {
        list.innerHTML = hist.q || hist.source
            ? '<div class="hist-empty">Nothing matches this filter.</div>'
            : '<div class="hist-empty">No changes on this site yet.<br>Every save made in this dashboard is listed here — and most can be undone.</div>';
        return;
    }
    let day = '';
    const parts = [];
    hist.entries.forEach(e => {
        const t = Date.parse(e.time);
        const d = t ? histDayLabel(t) : 'Unknown date';
        if (d !== day) {
            day = d;
            parts.push(`<div class="hx-day">${escapeHtml(d)}</div>`);
        }
        parts.push(histEntryHtml(e));
    });
    if (hist.entries.length < hist.total) {
        parts.push(`<div class="hx-load-more"><button type="button" class="btn small" id="historyMore">Load more (${fmtNum(hist.total - hist.entries.length)} older)</button></div>`);
    }
    list.innerHTML = parts.join('');
}

/** Re-render one entry in place (expand / show more) so the scroll position stays. */
function rerenderHistoryEntry(id) {
    const e = hist.entries.find(x => x.id === id);
    const el = document.querySelector(`#historyList .hx-item[data-id="${CSS.escape(id)}"]`);
    if (e && el) el.outerHTML = histEntryHtml(e);
}

/* ── undo ── */
const HISTORY_AFFECTS = {
    posts: ['content', 'redirects', 'fixer', 'menu', 'keywords', 'canonical'],
    links: ['content', 'fixer', 'menu', 'keywords', 'canonical'],
    redirects: ['redirects'],
};

function afterHistoryUndo(refresh) {
    if (refresh.includes('posts')) onPostsChanged();
    if (refresh.includes('links')) onLinksChanged();
    if (refresh.includes('redirects')) onRedirectsChanged();
    // onPostsChanged/onLinksChanged skip the tab on screen (it normally made the
    // change itself) - here it didn't, so reload it too unless it has unsaved work.
    const affected = new Set(refresh.flatMap(r => HISTORY_AFFECTS[r] || []));
    if (affected.has(activeView) && !unsavedTabs().length) markStale([activeView]);
}

async function undoHistoryEntry(id, btn) {
    const e = hist.entries.find(x => x.id === id);
    if (!e) return;
    const site = siteList.find(d => d.key === SITE)?.label || SITE;
    const viaJournal = e.source === 'replace' || e.source === 'fixer';
    const ok = await confirmDialog({
        title: 'Undo this change?',
        message: `On ${site}: ${e.summary || ''}. Each value below is put back only if it still holds what this change wrote — anything edited since is skipped.`
            + (viaJournal ? ' The exact previous field contents come from the tab\'s own backup.' : '')
            + ((e.changes || []).some(c => c.field === 'post_status' && (c.before === 'trash' || c.after === 'trash')) ? ' Undoing a trash/restore does not add or remove any 410 redirect.' : ''),
        changes: (e.changes || []).map(c => ({ post: histChangeLabel(c), from: histValue(c, 'after'), to: histValue(c, 'before') })),
        okLabel: 'Undo change', tone: 'warn',
    });
    if (!ok) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
        const json = await api('activity_undo.php', { method: 'POST', body: new URLSearchParams({ id }) });
        if (json.success) {
            afterHistoryUndo(json.refresh || []);
            const extra = [
                ...(json.skipped || []).map(s => `Skipped ${s.post_id ? '#' + s.post_id + ' ' : ''}${s.field || ''}: ${s.reason}`),
                ...(json.notes || []),
            ];
            if (extra.length) alertDialog('Undo finished', json.msg, extra);
            else toast(json.msg || 'Change undone', 'ok');
        } else {
            const lines = (json.skipped || []).map(s => `${s.post_id ? '#' + s.post_id + ' ' : ''}${s.field || ''}: ${s.reason}`);
            if (lines.length > 1) alertDialog('Nothing was undone', json.msg || '', lines);
            else toast(json.msg || 'Undo failed', 'err');
        }
    } catch (err) {
        console.error(err);
        toast('Undo failed — network error', 'err');
    }
    loadHistory();
    refreshHistoryCount();
}

/* ── CSV (client-side; the whole filtered list, one row per change) ── */
function histCsvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (s.length > 32000) s = s.slice(0, 32000) + '…'; // Excel's per-cell limit
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportHistoryCsv() {
    const btn = document.getElementById('historyCsv');
    let rows = hist.entries.slice();
    if (rows.length < hist.total) {
        btn.disabled = true;
        try {
            while (rows.length < hist.total) {
                const json = await api('activity_list.php', { params: { source: hist.source, q: hist.q, limit: 1000, offset: rows.length } });
                if (!json.success || !json.entries.length) break;
                rows = rows.concat(json.entries);
            }
        } catch (err) {
            console.error(err);
            toast('Export incomplete — network error', 'err');
        }
        btn.disabled = false;
    }
    if (!rows.length) { toast('Nothing to export'); return; }

    const out = [['Time', 'Site', 'Source', 'Action', 'Summary', 'Post IDs', 'Change', 'Post ID', 'Field / key / origin', 'Before', 'After', 'Undone', 'Entry ID', 'IP']];
    rows.forEach(e => {
        const base = [new Date(Date.parse(e.time)).toLocaleString(), e.site || SITE, HISTORY_SOURCE_LABEL[e.source] || e.source, e.action, e.summary, (e.post_ids || []).join(' ')];
        const tail = [e.undone ? 'yes' : '', e.id, e.ip || ''];
        const changes = e.changes || [];
        if (!changes.length) out.push([...base, '', '', '', '', '', ...tail]);
        changes.forEach(c => out.push([...base, c.kind, c.post_id || '', c.kind === 'redirect' ? '/' + c.origin + '/' : (c.kind === 'meta' ? c.key : c.field),
            histValue(c, 'before'), histValue(c, 'after'), ...tail]));
    });
    const csv = '﻿' + out.map(r => r.map(histCsvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        download: `history-${SITE}${hist.source ? '-' + hist.source : ''}-${stamp}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${fmtNum(rows.length)} ${rows.length === 1 ? 'entry' : 'entries'}`, 'ok');
}

/* ── open / close / bind ── */
const isHistoryOpen = () => document.body.classList.contains('drawer-open');

function openHistory() {
    // Never stack on top of the Find & Replace drawer.
    if (document.getElementById('fr-drawer')?.classList.contains('fr-open')) document.getElementById('fr-drawer-close').click();
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
    document.getElementById('historyReload').addEventListener('click', () => loadHistory());
    document.getElementById('historySearch').addEventListener('input', debounce(e => {
        hist.q = e.target.value.trim();
        loadHistory();
    }, 250));
    document.getElementById('historyChips')?.addEventListener('click', e => {
        const chip = e.target.closest('[data-source]');
        if (!chip) return;
        hist.source = chip.dataset.source;
        loadHistory();
    });
    document.getElementById('historyList').addEventListener('click', e => {
        const undo = e.target.closest('[data-undo]');
        if (undo) { undoHistoryEntry(undo.dataset.undo, undo); return; }
        const tog = e.target.closest('[data-toggle]');
        if (tog) {
            const id = tog.dataset.toggle;
            hist.expanded.has(id) ? hist.expanded.delete(id) : hist.expanded.add(id);
            rerenderHistoryEntry(id);
            return;
        }
        const more = e.target.closest('[data-more]');
        if (more) {
            const key = more.dataset.more;
            hist.moreOpen.has(key) ? hist.moreOpen.delete(key) : hist.moreOpen.add(key);
            rerenderHistoryEntry(key.split(':')[0]);
            return;
        }
        if (e.target.closest('#historyMore')) {
            e.target.closest('#historyMore').disabled = true;
            loadHistory({ append: true });
        }
    });
}
