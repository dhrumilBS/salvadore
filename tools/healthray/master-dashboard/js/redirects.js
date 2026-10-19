/* ══════════════════════════ Redirects tab ══════════════════════════
 * Yoast Premium redirects (origin -> destination, from wp_options) cross-
 * referenced against live posts, with the same live-link-check (on the
 * origin URL) and filtered-CSV-export UX as the Content tab. */

const redirectsState = {
    search: '',
    type: '',        // comma list e.g. "301,410"
    format: '',      // '', 'plain', 'regex'
    match: '',       // '', 'origin_live', 'dest_missing', 'healthy'
    sort: 'origin',
    dir: 'ASC',
    page: 1,
    per_page: 50,
    link_status: '', // export-only live-check filter on the origin URL
};

let currentRedirects = [];
const nextRedirectsSignal = latestOnly();
let redirectsPager = null; // mdPager, created in bindRedirectsTab()

function redirectTypeBadgeClass(type) {
    if (type === 301 || type === 302) return 'ls-redirect';
    if (type === 410 || type === 404) return 'ls-gone';
    return 'badge-neutral';
}

function updateRedirectsExportLink() {
    const { page, per_page, ...rest } = redirectsState;
    document.getElementById('redirectsExportCsv').href = apiUrl('redirects_export.php', rest);
}

function renderRedirectsHead() {
    document.getElementById('redirectsHead').innerHTML = '<tr>'
        + '<th class="r-sel-col"><input type="checkbox" id="rSelectAll" title="Select every rule on this page" aria-label="Select all on this page"></th>' +
        [['Origin', 1], ['Type', 0], ['Destination', 1], ['Format', 0],
        ['Origin match', 0], ['Destination match', 0], ['Link status (origin)', 0]]
            .map(([h, wide]) => `<th${wide ? ' class="url-col"' : ''}>${h}</th>`).join('') + '<th class="r-act-col">Actions</th></tr>';
}

function matchBadge(post) {
    const cls = post.status === 'publish' ? 'badge-publish' : (post.status === 'trash' ? 'badge-trash' : 'badge-neutral');
    return `<span class="badge ${cls}" title="#${post.id} · ${escapeHtml(post.post_type)} · ${escapeHtml(post.status)}">${escapeHtml(truncate(decodeEntities(post.title), 36))}</span>`;
}

function renderRedirectRow(r) {
    // Origin/destination shown in full — these are the two values the whole
    // tab exists to compare, so neither is ever truncated.
    const originCell = r.origin_url
        ? urlCellHtml(r.origin_url, '/' + r.origin + '/')
        : urlCellHtml('', r.origin);

    const destCell = !r.url
        ? '<span class="url-empty">—</span>'
        : r.dest_url
            ? urlCellHtml(r.dest_url, '/' + r.url + '/')
            : urlCellHtml('', r.url);

    // A trashed/draft origin post is the normal state of a retired URL; only a
    // post that is still reachable conflicts with the redirect.
    const originMatch = !r.origin_post
        ? '<span class="col-note">—</span>'
        : r.origin_live
            ? `${matchBadge(r.origin_post)} <span class="warn-flag" title="Origin still resolves to a live post - this redirect may be stale or conflicting">⚠️</span>`
            : matchBadge(r.origin_post);

    const destMatch = !r.url
        ? '<span class="col-note">—</span>'
        : r.format !== 'plain'
            ? '<span class="col-note" title="Regex destination - not checked against posts">regex</span>'
            : !r.dest_post
                ? '<span class="badge ls-gone" title="Destination doesn\'t match any known post">missing</span>'
                : r.dest_live
                    ? matchBadge(r.dest_post)
                    : `${matchBadge(r.dest_post)} <span class="warn-flag" title="Destination post isn't published - visitors are sent to a page that doesn't load">⚠️</span>`;

    const key = redirectKey(r);
    const sel = redirectSelection.has(key);
    return `<tr data-r-key="${escapeHtml(key)}"${sel ? ' class="r-selected"' : ''}>
        <td class="r-sel-col"><input type="checkbox" class="r-row-cb" ${sel ? 'checked' : ''} aria-label="Select this rule"></td>
        <td class="url-col">${originCell}</td>
        <td><span class="badge ${redirectTypeBadgeClass(r.type)}">${r.type || '—'}</span></td>
        <td class="url-col">${destCell}</td>
        <td><span class="badge badge-neutral">${escapeHtml(r.format)}</span></td>
        <td>${originMatch}</td>
        <td>${destMatch}</td>
        <td>${LinkStatus.cell(r.origin_url)}</td>
        <td class="r-act-col"><span class="r-row-actions">
            <button type="button" class="btn small" data-r-act="edit" title="Edit this rule">Edit</button>
            <button type="button" class="btn small" data-r-act="copy" title="New rule with these values">Duplicate</button>
            <button type="button" class="btn small danger" data-r-act="delete" title="Delete this rule">Delete</button>
        </span></td>
    </tr>`;
}

function showRedirectsState(msg, isError) {
    document.getElementById('redirectsBody').innerHTML = tableStateRow(9, msg, isError ? 'error' : '', { html: true });
}

function loadRedirects() {
    showRedirectsState('<span class="spinner"></span> Loading…', false);
    updateRedirectsExportLink();

    const { link_status, ...listParams } = redirectsState;
    api('redirects.php', { params: listParams, signal: nextRedirectsSignal() })
        .then(json => {
            if (!json.success) {
                currentRedirects = [];
                showRedirectsState(escapeHtml(json.msg || 'Failed to load redirects'), true);
                return;
            }
            currentRedirects = json.data;
            redirectsState.page = json.page;
            document.getElementById('redirectsBody').innerHTML = currentRedirects.length
                ? currentRedirects.map(renderRedirectRow).join('')
                : '<tr><td colspan="9" class="state-msg">No redirects match the current filters/search.</td></tr>';
            document.getElementById('rStTotal').textContent = fmtNum(json.total);
            redirectsPager.render({ page: json.page, total: json.total });
            syncRedirectSelection();
        })
        .catch(err => {
            if (isAbort(err)) return;
            console.error(err);
            currentRedirects = [];
            showRedirectsState('Failed to load redirects — check the console/network tab', true);
        });
}

function goToRedirectsPage(p) {
    redirectsState.page = p;
    loadRedirects();
}

function bindRedirectsTab() {
    const reload = () => { redirectsState.page = 1; loadRedirects(); };

    document.getElementById('rSearch').addEventListener('input', debounce(() => {
        redirectsState.search = document.getElementById('rSearch').value.trim();
        reload();
    }, 350));

    document.querySelectorAll('.redirect-type-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            redirectsState.type = Array.from(document.querySelectorAll('.redirect-type-cb:checked')).map(c => c.value).join(',');
            reload();
        });
    });

    document.getElementById('rFormat').addEventListener('change', e => { redirectsState.format = e.target.value; reload(); });
    document.getElementById('rMatch').addEventListener('change', e => { redirectsState.match = e.target.value; reload(); });
    document.getElementById('rSort').addEventListener('change', e => { redirectsState.sort = e.target.value; loadRedirects(); });

    document.getElementById('rDir').addEventListener('click', () => {
        redirectsState.dir = redirectsState.dir === 'DESC' ? 'ASC' : 'DESC';
        document.getElementById('rDir').textContent = redirectsState.dir === 'DESC' ? '↓ DESC' : '↑ ASC';
        loadRedirects();
    });

    bindPanelToggle('rLinkFilterBtn', 'rLinkFilterPanel');

    document.querySelectorAll('.redirect-link-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            redirectsState.link_status = Array.from(document.querySelectorAll('.redirect-link-filter-cb:checked')).map(c => c.value).join(',');
            updateRedirectsExportLink();
        });
    });

    document.getElementById('redirectsExportCsv').addEventListener('click', e => confirmSlowExport(e,
        'This export will live-check every matching redirect\'s origin URL before including it — it can take a while for large result sets.',
        !!redirectsState.link_status));

    document.getElementById('rClearFiltersBtn').addEventListener('click', () => {
        Object.assign(redirectsState, { search: '', type: '', format: '', match: '', page: 1 });
        document.getElementById('rSearch').value = '';
        document.querySelectorAll('.redirect-type-cb').forEach(cb => { cb.checked = false; });
        document.getElementById('rFormat').value = '';
        document.getElementById('rMatch').value = '';
        loadRedirects();
    });

    redirectsPager = mdPager('rPager', {
        sizes: [20, 50, 100, 200], perPage: redirectsState.per_page, noun: 'redirect', storeKey: 'redirects.perPage',
        onPage: goToRedirectsPage,
        onPerPage: n => { redirectsState.per_page = n; goToRedirectsPage(1); },
    });
    redirectsState.per_page = redirectsPager.perPage;

    document.getElementById('rCheckAllLinksBtn').addEventListener('click', e => {
        LinkStatus.checkManyWithButton(currentRedirects.map(r => r.origin_url), e.currentTarget, { skipChecked: true });
    });

    bindRedirectEditing();
    renderRedirectsHead();
}

/* ══════════════════ Editing: add / edit / duplicate / delete / bulk / import ══════════════════
 * Every write goes through redirect_save.php twice: a dry run first (server
 * validation + warnings, nothing written), then confirmDialog() listing exactly
 * what changes, then the real save. The server re-checks each edited/deleted
 * rule against what this page loaded, so a rule changed elsewhere in the
 * meantime is refused rather than overwritten. */

const GONE_TYPES = [410, 451];
const REDIRECT_TYPES = [301, 302, 307, 410, 451];
const redirectSelection = new Map(); // key -> row, kept across pages; cleared after a save
let redirectModal = { mode: 'add', from: null };

const redirectKey = r => r.format + '|' + r.origin;
const isExternalUrl = u => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(u);
const redirectOriginLabel = (origin, format) => format === 'regex' ? origin : '/' + origin + '/';
const redirectRuleLabel = v => !v ? '' : v.type + (v.url ? ' → ' + (isExternalUrl(v.url) ? v.url : '/' + v.url + '/') : ' Gone');
const redirectFrom = r => ({ origin: r.origin, format: r.format, url: r.url, type: r.type });

/** Absolute URL for an "Open ↗" link, or '' when the value can't be opened. */
function redirectOpenUrl(value) {
    value = String(value || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (isExternalUrl(value)) return location.protocol + value;
    const home = (currentRedirects.find(r => r.origin_url)?.origin_url || '').replace(/^(https?:\/\/[^/]+).*$/i, '$1');
    return home ? home + '/' + value.replace(/^\/+/, '') : '';
}

/* ---------- save pipeline ---------- */

function postRedirectOps(ops, { dryRun = false, replace = false } = {}) {
    return api('redirect_save.php', {
        method: 'POST',
        body: new URLSearchParams({ ops: JSON.stringify(ops), dry_run: dryRun ? '1' : '', replace: replace ? '1' : '' }),
    });
}

/**
 * Dry run -> confirmDialog() -> save. Resolves one of:
 *   {saved} | {cancelled} | {unchanged} | {invalid: results, msg} (nothing written) | {error}
 */
async function runRedirectOps(ops, { title, okLabel, tone = 'primary', replace = false, message = '' } = {}) {
    let dry;
    try {
        dry = await postRedirectOps(ops, { dryRun: true, replace });
    } catch (err) {
        console.error(err);
        return { error: 'Request failed — check the console/network tab' };
    }
    if (!dry.success) return dry.status === 'invalid' ? { invalid: dry.results || [], msg: dry.msg } : { error: dry.msg || 'Validation failed' };

    const todo = (dry.results || []).filter(r => !r.unchanged);
    if (!todo.length) return { unchanged: true };

    const verbs = { add: 'Add', edit: 'Edit', delete: 'Delete' };
    const warnings = todo.flatMap(r => (r.warnings || []).map(w => `${redirectOriginLabel(r.origin, r.format)}: ${w}`));
    const skipped = (dry.results || []).length - todo.length;
    const ok = await confirmDialog({
        title,
        message: [
            message,
            skipped ? `${pluralize(skipped, 'rule')} already ${skipped === 1 ? 'has' : 'have'} these values and will be left as is.` : '',
            warnings.length
                ? `⚠ ${pluralize(warnings.length, 'warning')}:\n` + warnings.slice(0, 8).map(w => '• ' + w).join('\n') + (warnings.length > 8 ? `\n…and ${warnings.length - 8} more` : '')
                : '',
        ].filter(Boolean).join('\n\n'),
        changes: todo.map(r => ({
            post: `${r.action === 'add' && r.before ? 'Replace' : verbs[r.action]} ${redirectOriginLabel(r.origin, r.format)}${r.format === 'regex' ? ' (regex)' : ''}`,
            from: r.before ? redirectRuleLabel(r.before) : undefined,
            to: r.after ? redirectRuleLabel(r.after) : '',
            toLabel: 'rule deleted',
        })),
        okLabel: okLabel || `Save ${pluralize(todo.length, 'change')}`,
        tone,
    });
    if (!ok) return { cancelled: true };

    let json;
    try {
        json = await postRedirectOps(ops, { replace });
    } catch (err) {
        console.error(err);
        return { error: 'Save request failed — check the console/network tab' };
    }
    if (!json.success) return json.status === 'invalid' ? { invalid: json.results || [], msg: json.msg } : { error: json.msg || 'Redirects not saved' };
    if (json.status === 'unchanged') return { unchanged: true };

    // Those URLs now answer differently - drop any cached live-check result for them.
    (json.results || []).forEach(r => {
        if (r.format === 'plain' && !r.unchanged) LinkStatus.forgetPath(r.origin);
    });
    toast(`Saved ${pluralize(todo.length, 'redirect change')}` + (json.backup_file ? ' (backup taken)' : ''), 'ok');
    redirectSelection.clear();
    loadRedirects();
    onRedirectsChanged();
    // A URL that now redirects or is gone must not stay any post's canonical. Not awaited:
    // the caller closes its modal first, the prompt follows once the check answers.
    const retired = (json.results || [])
        .filter(r => r.format === 'plain' && !r.unchanged && r.after && REDIRECT_TYPES.includes(Number(r.after.type)))
        .map(r => r.origin);
    offerCanonicalCleanup(retired, { reason: `${pluralize(retired.length, 'URL')} now ${retired.length === 1 ? 'redirects or is' : 'redirect or are'} gone` });
    return { saved: true };
}

/** Report a failed run from a row action / the bulk bar: which rules failed and why. */
function showRedirectFailures(res, ops) {
    if (res.error) { toast(res.error, 'err'); return; }
    if (res.unchanged) { toast('Nothing to change - those rules already have these values', ''); return; }
    if (!res.invalid) return;
    const lines = res.invalid.filter(r => !r.ok).map(r => {
        const op = ops[r.i] || {};
        const label = op.from ? redirectOriginLabel(op.from.origin, op.from.format) : (r.origin || op.origin || '');
        return `${label}: ${r.error}`;
    });
    alertDialog('Nothing was saved', res.msg || 'Some changes could not be applied.', lines);
}

/* ---------- selection + bulk bar ---------- */

function syncRedirectSelection() {
    const n = redirectSelection.size;
    document.getElementById('rBulkCount').textContent = fmtNum(n);
    document.getElementById('rBulkBar').classList.toggle('show', n > 0 && activeView === 'redirects');
    const all = document.getElementById('rSelectAll');
    if (all) {
        const onPage = currentRedirects.filter(r => redirectSelection.has(redirectKey(r))).length;
        all.checked = currentRedirects.length > 0 && onPage === currentRedirects.length;
        all.indeterminate = onPage > 0 && onPage < currentRedirects.length;
    }
}

function setRowSelected(row, on) {
    const key = redirectKey(row);
    if (on) redirectSelection.set(key, row); else redirectSelection.delete(key);
    const tr = document.querySelector(`#redirectsBody tr[data-r-key="${CSS.escape(key)}"]`);
    if (tr) {
        tr.classList.toggle('r-selected', on);
        const cb = tr.querySelector('.r-row-cb');
        if (cb) cb.checked = on;
    }
}

function clearRedirectSelection() {
    [...redirectSelection.values()].forEach(r => setRowSelected(r, false));
    redirectSelection.clear();
    syncRedirectSelection();
}

async function bulkRedirectType() {
    const type = parseInt(document.getElementById('rBulkType').value, 10);
    const rows = [...redirectSelection.values()];
    const gone = GONE_TYPES.includes(type);
    const needDest = rows.filter(r => !gone && !r.url);
    if (needDest.length) {
        alertDialog(`A ${type} needs a destination`,
            `${pluralize(needDest.length, 'selected rule')} ${needDest.length === 1 ? 'has' : 'have'} no destination. Use "Set destination" (or edit ${needDest.length === 1 ? 'it' : 'them'}) first.`,
            needDest.map(r => redirectOriginLabel(r.origin, r.format)));
        return;
    }
    const ops = rows.map(r => ({ action: 'edit', from: redirectFrom(r), origin: r.origin, format: r.format, type, url: gone ? '' : r.url }));
    const res = await runRedirectOps(ops, {
        title: `Change ${pluralize(rows.length, 'redirect')} to ${type}?`,
        message: gone && rows.some(r => r.url) ? `${type} rules have no destination - the current destinations are dropped.` : '',
        okLabel: `Set ${type}`,
        tone: gone ? 'danger' : 'primary',
    });
    if (!res.saved && !res.cancelled) showRedirectFailures(res, ops);
}

async function bulkRedirectDest() {
    const input = document.getElementById('rBulkDest');
    const url = input.value.trim();
    if (!url) { toast('Type the new destination first', 'warn'); input.focus(); return; }
    const rows = [...redirectSelection.values()];
    // A Gone rule given a destination becomes a 301.
    const ops = rows.map(r => ({ action: 'edit', from: redirectFrom(r), origin: r.origin, format: r.format, type: GONE_TYPES.includes(r.type) ? 301 : r.type, url }));
    const res = await runRedirectOps(ops, {
        title: `Point ${pluralize(rows.length, 'redirect')} at ${url}?`,
        message: rows.some(r => GONE_TYPES.includes(r.type)) ? '410/451 rules among them become 301 redirects.' : '',
        okLabel: 'Set destination',
    });
    if (res.saved) input.value = '';
    else if (!res.cancelled) showRedirectFailures(res, ops);
}

async function deleteRedirects(rows) {
    const ops = rows.map(r => ({ action: 'delete', from: redirectFrom(r) }));
    const res = await runRedirectOps(ops, {
        title: `Delete ${pluralize(rows.length, 'redirect')}?`,
        message: 'Visitors to these old URLs will get whatever the site serves there now (usually a 404). A backup is taken first, and History can undo it.',
        okLabel: `Delete ${pluralize(rows.length, 'redirect')}`,
        tone: 'danger',
    });
    if (!res.saved && !res.cancelled) showRedirectFailures(res, ops);
    return res;
}

/* ---------- add / edit / duplicate modal ---------- */

function openRedirectModal(mode, row = null) {
    const $ = id => document.getElementById(id);
    redirectModal = { mode, from: mode === 'edit' ? row : null };
    $('rEditTitle').textContent = { add: 'Add redirect', edit: 'Edit redirect', copy: 'Duplicate redirect' }[mode];
    $('rEditSub').textContent = mode === 'edit' ? redirectRuleLabel(row) : '';
    $('rEditType').value = String(row && REDIRECT_TYPES.includes(row.type) ? row.type : 301);
    $('rEditFormat').value = row?.format || 'plain';
    // Duplicate keeps type + destination and asks for a new origin.
    $('rEditOrigin').value = !row || mode === 'copy' ? '' : row.format === 'regex' ? row.origin : '/' + row.origin + '/';
    $('rEditDest').value = !row?.url ? '' : row.format === 'regex' || isExternalUrl(row.url) ? row.url : '/' + row.url + '/';
    $('rEditDelete').hidden = mode !== 'edit';
    setRedirectHint('');
    syncRedirectModal();
    $('rEditModal').classList.add('open');
    setTimeout(() => (mode === 'edit' ? $('rEditDest') : $('rEditOrigin')).focus(), 40);
}

function closeRedirectModals() {
    document.querySelectorAll('#rEditModal, #rImportModal').forEach(m => m.classList.remove('open'));
}

const isRedirectModalOpen = () => !!document.querySelector('#rEditModal.open, #rImportModal.open');

function setRedirectHint(msg, kind = '') {
    const el = document.getElementById('rEditHint');
    el.textContent = msg;
    el.className = 'fx-modal-hint' + (kind ? ' ' + kind : '');
}

/** Gone types disable the destination; regex relabels the origin; Open ↗ links follow the inputs. */
function syncRedirectModal() {
    const $ = id => document.getElementById(id);
    const gone = GONE_TYPES.includes(parseInt($('rEditType').value, 10));
    const regex = $('rEditFormat').value === 'regex';
    $('rEditDestField').classList.toggle('is-disabled', gone);
    $('rEditDest').disabled = gone;
    $('rEditOriginLabel').textContent = regex ? 'Pattern (regex)' : 'Old URL (origin)';
    $('rEditOrigin').placeholder = regex ? '^/old-section/(.*)' : '/old-page/  or  https://site.com/old-page/';
    $('rEditDest').placeholder = regex ? '/new-section/$1' : '/new-page/  or  https://other-site.com/page';
    const o = regex ? '' : redirectOpenUrl($('rEditOrigin').value);
    const d = gone || regex ? '' : redirectOpenUrl($('rEditDest').value);
    $('rEditOpenOrigin').hidden = !o;
    $('rEditOpenOrigin').href = o || '#';
    $('rEditOpenDest').hidden = !d;
    $('rEditOpenDest').href = d || '#';
}

async function saveRedirectModal() {
    const $ = id => document.getElementById(id);
    const type = parseInt($('rEditType').value, 10);
    const op = {
        action: redirectModal.mode === 'edit' ? 'edit' : 'add',
        origin: $('rEditOrigin').value.trim(),
        format: $('rEditFormat').value,
        type,
        url: GONE_TYPES.includes(type) ? '' : $('rEditDest').value.trim(),
    };
    if (!op.origin) { setRedirectHint('The origin is required.', 'bad'); $('rEditOrigin').focus(); return; }
    if (!GONE_TYPES.includes(type) && !op.url) { setRedirectHint(`A ${type} redirect needs a destination.`, 'bad'); $('rEditDest').focus(); return; }
    if (redirectModal.from) op.from = redirectFrom(redirectModal.from);

    const btn = $('rEditSave');
    btn.disabled = true;
    setRedirectHint('Checking…');
    try {
        let res = await runRedirectOps([op], {
            title: op.action === 'edit' ? 'Save redirect changes?' : 'Add this redirect?',
            okLabel: op.action === 'edit' ? 'Save changes' : 'Add redirect',
        });
        // Adding over an origin that already has a rule: offer to replace it.
        const dup = res.invalid?.[0];
        if (op.action === 'add' && dup && dup.existing) {
            setRedirectHint(dup.error, 'warn');
            res = await runRedirectOps([op], {
                title: 'Replace the existing redirect?',
                message: `${redirectOriginLabel(dup.origin, dup.format)} already has a rule. Replace it?`,
                okLabel: 'Replace', tone: 'danger', replace: true,
            });
        }
        if (res.saved) { closeRedirectModals(); return; }
        if (res.cancelled) { setRedirectHint(''); return; }
        if (res.unchanged) { setRedirectHint('Nothing changed - the rule already has these values.', 'warn'); return; }
        setRedirectHint(res.error || res.invalid?.find(r => !r.ok)?.error || res.msg || 'Not saved.', 'bad');
    } finally {
        btn.disabled = false;
    }
}

/* ---------- import ---------- */

/** One CSV/TSV line -> trimmed cells (quotes + "" escapes; tab-separated when the line has a tab). */
function splitRedirectLine(line) {
    const sep = line.includes('\t') ? '\t' : ',';
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') quoted = false;
            else cur += c;
        } else if (c === '"' && cur.trim() === '') { quoted = true; cur = ''; }
        else if (c === sep) { out.push(cur.trim()); cur = ''; }
        else cur += c;
    }
    out.push(cur.trim());
    // Export CSVs prefix formula-like cells with an apostrophe (dw_csv_write).
    return out.map(v => /^'[=+\-@]/.test(v) ? v.slice(1) : v);
}

/** Pasted text -> {ops (each with its source line), errors}. */
function parseRedirectImport(text, defaultType) {
    const ops = [], errors = [];
    let cols = null; // column mapping when an exported CSV (with its header row) is pasted
    text.split(/\r?\n/).forEach((raw, n) => {
        const line = raw.replace(/^﻿/, '').trim();
        if (!line || line.startsWith('#')) return;
        const cells = splitRedirectLine(line);
        const lower = cells.map(c => c.toLowerCase());
        if (!cols && lower.includes('origin') && lower.includes('type')) {
            cols = { origin: lower.indexOf('origin'), url: lower.indexOf('destination'), type: lower.indexOf('type'), format: lower.indexOf('format') };
            return;
        }
        let origin, url, type, format = 'plain';
        if (cols) {
            origin = cells[cols.origin] || '';
            url = cols.url >= 0 ? cells[cols.url] || '' : '';
            type = cells[cols.type] || '';
            if (cols.format >= 0 && cells[cols.format] === 'regex') format = 'regex';
        } else {
            [origin = '', url = '', type = ''] = cells;
            // "/old/, 410": the second cell is a type, not a destination
            if (!type && /^\d{3}$/.test(url)) { type = url; url = ''; }
        }
        type = type ? parseInt(type, 10) : defaultType;
        if (!origin) { errors.push(`Line ${n + 1}: no origin`); return; }
        if (!REDIRECT_TYPES.includes(type)) { errors.push(`Line ${n + 1}: unsupported type "${type}"`); return; }
        ops.push({ action: 'add', origin, url: GONE_TYPES.includes(type) ? '' : url, type, format, line: n + 1 });
    });
    return { ops, errors };
}

async function runRedirectImport() {
    const $ = id => document.getElementById(id);
    const hint = $('rImportHint'), list = $('rImportErrors');
    const showErrors = (msg, lines) => {
        hint.textContent = msg;
        hint.className = 'fx-modal-hint bad';
        list.innerHTML = lines.slice(0, 200).map(l => `<li class="cl-line">${escapeHtml(l)}</li>`).join('')
            + (lines.length > 200 ? `<li class="cl-more">…and ${lines.length - 200} more</li>` : '');
        list.hidden = !lines.length;
    };
    list.hidden = true;
    const { ops, errors } = parseRedirectImport($('rImportText').value, parseInt($('rImportType').value, 10));
    if (errors.length) { showErrors(`${pluralize(errors.length, 'line')} could not be read - fix ${errors.length === 1 ? 'it' : 'them'} and try again.`, errors); return; }
    if (!ops.length) { showErrors('Paste at least one redirect.', []); return; }
    if (ops.length > 1000) { showErrors('At most 1,000 redirects per import - split the list.', []); return; }

    const btn = $('rImportRun');
    btn.disabled = true;
    hint.textContent = 'Checking…';
    hint.className = 'fx-modal-hint';
    try {
        const replace = $('rImportReplace').checked;
        const res = await runRedirectOps(ops.map(({ line, ...op }) => op), {
            title: `Import ${pluralize(ops.length, 'redirect')}?`,
            okLabel: 'Import',
            replace,
        });
        if (res.saved) { $('rImportText').value = ''; hint.textContent = ''; closeRedirectModals(); return; }
        if (res.cancelled) { hint.textContent = ''; return; }
        if (res.unchanged) { showErrors('Nothing to import - every rule already exists with these values.', []); return; }
        if (res.error) { showErrors(res.error, []); return; }
        const bad = (res.invalid || []).filter(r => !r.ok);
        showErrors(`${pluralize(bad.length, 'line')} rejected - nothing was imported.`
            + (!replace && bad.some(r => r.existing) ? ' Tick "Replace rules that already exist" to overwrite existing origins.' : ''),
            bad.map(r => `Line ${ops[r.i]?.line ?? '?'} (${ops[r.i]?.origin || ''}): ${r.error}`));
    } finally {
        btn.disabled = false;
    }
}

/* ---------- wiring ---------- */

/** Redirects-tab keys (app.js routes every keydown here while the tab is active): Esc closes / clears, n = new rule. */
function rHandleKey(e) {
    if (e.key === 'Escape') {
        if (isRedirectModalOpen()) { closeRedirectModals(); return true; }
        if (redirectSelection.size) { clearRedirectSelection(); return true; }
        return false;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'n' && !isRedirectModalOpen()) {
        openRedirectModal('add');
        return true;
    }
    return false;
}

function bindRedirectEditing() {
    const $ = id => document.getElementById(id);
    const rowOf = el => currentRedirects.find(r => redirectKey(r) === el.closest('tr[data-r-key]')?.dataset.rKey);

    $('rAddBtn').addEventListener('click', () => openRedirectModal('add'));
    $('rImportBtn').addEventListener('click', () => {
        $('rImportModal').classList.add('open');
        setTimeout(() => $('rImportText').focus(), 40);
    });

    $('redirectsBody').addEventListener('change', e => {
        if (!e.target.classList.contains('r-row-cb')) return;
        const row = rowOf(e.target);
        if (row) setRowSelected(row, e.target.checked);
        syncRedirectSelection();
    });
    $('redirectsHead').addEventListener('change', e => {
        if (e.target.id !== 'rSelectAll') return;
        currentRedirects.forEach(r => setRowSelected(r, e.target.checked));
        syncRedirectSelection();
    });
    $('redirectsBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-r-act]');
        const row = btn && rowOf(btn);
        if (!row) return;
        if (btn.dataset.rAct === 'delete') deleteRedirects([row]);
        else openRedirectModal(btn.dataset.rAct, row);
    });

    $('rBulkTypeApply').addEventListener('click', bulkRedirectType);
    $('rBulkDestApply').addEventListener('click', bulkRedirectDest);
    $('rBulkDest').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bulkRedirectDest(); } });
    $('rBulkDelete').addEventListener('click', () => deleteRedirects([...redirectSelection.values()]));
    $('rBulkClear').addEventListener('click', clearRedirectSelection);

    ['rEditType', 'rEditFormat'].forEach(id => $(id).addEventListener('change', () => { syncRedirectModal(); setRedirectHint(''); }));
    ['rEditOrigin', 'rEditDest'].forEach(id => $(id).addEventListener('input', debounce(syncRedirectModal, 200)));
    $('rEditForm').addEventListener('submit', e => { e.preventDefault(); saveRedirectModal(); });
    $('rEditSave').addEventListener('click', saveRedirectModal);
    $('rEditDelete').addEventListener('click', async () => {
        const res = await deleteRedirects([redirectModal.from]);
        if (res.saved) closeRedirectModals();
    });
    $('rImportRun').addEventListener('click', runRedirectImport);

    document.querySelectorAll('#rEditModal, #rImportModal').forEach(m => m.addEventListener('click', e => {
        if (e.target === m || e.target.closest('[data-r-close]')) closeRedirectModals();
    }));
}
