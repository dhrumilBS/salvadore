/* ══════════════════════════════════════════════════════════
   Master Dashboard — shared helpers (loaded first, used by every tab)
   Plain globals, no bundler: utils, URL cells, toasts, copy buttons,
   theme, site switcher, filter options, the one live link-status
   checker, and the "trashed -> add a 410?" redirect prompts.
   ══════════════════════════════════════════════════════════ */

/* ---------- small utils ---------- */
function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) usp.set(k, v);
    });
    return usp.toString();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) {
    s = String(s ?? '');
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Each call gets its own timer, so two tabs' search boxes never cancel each other. */
function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function statusBadge(status) {
    return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function toast(msg, kind = '') {
    const box = document.getElementById('toast');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast-item' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

/** Show/hide a secondary toolbar row and reflect that on its trigger button. */
function bindPanelToggle(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    btn.addEventListener('click', () => {
        const open = panel.classList.toggle('open');
        btn.classList.toggle('is-open', open);
    });
}

/* ---------- clipboard ---------- */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall through */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch (e) { return false; }
}

/** One delegated copy handler for the whole page - covers every table and the detail modal. */
function bindCopyButtons() {
    document.addEventListener('click', async e => {
        const btn = e.target.closest('.btn-copy');
        if (!btn) return;
        const ok = await copyToClipboard(btn.dataset.copy || '');
        if (!ok) { toast('Copy failed — clipboard blocked', 'err'); return; }
        btn.classList.add('copied');
        toast('URL copied', 'ok');
        setTimeout(() => btn.classList.remove('copied'), 1000);
    });
}

/* ── URL cells ───────────────────────────────────────────────
 * URLs are rendered in full rather than truncated: they're the field
 * you actually need to read, compare and copy. Split into
 * scheme/host/path so the varying part (the path) stands out, and
 * paired with a copy button. */

function splitUrlParts(url) {
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(String(url || ''));
    if (!m) return { scheme: '', host: '', path: String(url || '') };
    return { scheme: m[1], host: m[2], path: m[3] };
}

/** Full URL, wrapped, with a copy button. `text` overrides the shown label. */
function urlCellHtml(href, text = null, emptyLabel = '—') {
    const shown = text !== null ? String(text) : String(href || '');
    if (!shown) return `<span class="url-empty">${escapeHtml(emptyLabel)}</span>`;

    const p = splitUrlParts(shown);
    const inner = p.host
        ? `<span class="u-scheme">${escapeHtml(p.scheme)}</span><span class="u-host">${escapeHtml(p.host)}</span><span class="u-path">${escapeHtml(p.path)}</span>`
        : `<span class="u-path">${escapeHtml(shown)}</span>`;

    const label = href
        ? `<a class="url-full" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapeHtml(href)}">${inner}</a>`
        : `<span class="url-full" title="${escapeHtml(shown)}">${inner}</span>`;

    return `<div class="url-cell">${label}
        <button type="button" class="btn-icon btn-copy" data-copy="${escapeHtml(href || shown)}" title="Copy URL" aria-label="Copy URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button></div>`;
}

/* ══════════════════════════ Live link status ══════════════════════════
 * The one implementation for every tab (Content permalinks, Links-tab
 * URLs, Redirect origins). Results are cached by URL, so the same URL
 * shows the same result wherever it appears, and a check run on one tab
 * is already there on the others. Any element carrying
 * data-status-url="<url>" is re-rendered when that URL's result changes.
 * Single checks hit api/check_url_status.php; "Check all" batches go to
 * api/check_links_bulk.php (server-side curl_multi, 250 URLs per call). */

const LinkStatus = (() => {
    const cache = {}; // url -> {checking} | {error} | {status_code, bucket, redirect_url}
    const listeners = [];

    function bucket(url) {
        const s = cache[url];
        if (!s) return 'unchecked';
        if (s.checking) return 'checking';
        if (s.error) return 'error';
        return s.bucket || 'unchecked';
    }

    function badge(url) {
        const s = cache[url];
        const u = escapeHtml(url);
        if (!s) return `<button type="button" class="btn-check-link" data-check-url="${u}">Check</button>`;
        if (s.checking) return '<span class="spinner"></span>';
        if (s.error || s.bucket === 'blocked') {
            const label = s.bucket === 'blocked' ? 'blocked' : 'error';
            return `<span class="badge ls-${label}" title="${escapeHtml(s.error || 'Not allowed to check this URL')}">${label}</span>` +
                `<button type="button" class="btn-check-link" data-check-url="${u}" title="Retry">↻</button>`;
        }
        // Where it redirected to, in full — truncating this hid the one
        // detail you check a redirect for.
        const redirectNote = s.redirect_url
            ? `<span class="ls-target" title="${escapeHtml(s.redirect_url)}">→ ${escapeHtml(s.redirect_url)}</span>`
            : '';
        return `<span class="badge ls-${s.bucket}">${s.status_code}</span>` +
            `<button type="button" class="btn-check-link" data-check-url="${u}" title="Recheck">↻</button>` +
            redirectNote;
    }

    /** Wrapper element that refreshes itself whenever this URL's result changes. */
    function cell(url) {
        if (!url) return '<span class="col-note">n/a</span>';
        return `<span class="ls-cell" data-status-url="${escapeHtml(url)}">${badge(url)}</span>`;
    }

    function refresh(url) {
        document.querySelectorAll('[data-status-url]').forEach(el => {
            if (el.dataset.statusUrl === url) el.innerHTML = badge(url);
        });
    }

    function notify() {
        listeners.forEach(fn => fn());
    }

    async function checkOne(url) {
        cache[url] = { checking: true };
        refresh(url);
        try {
            const res = await fetch('api/check_url_status.php?url=' + encodeURIComponent(url));
            const json = await res.json();
            cache[url] = json.success
                ? { status_code: json.status_code, bucket: json.bucket, redirect_url: json.redirect_url }
                : { error: json.msg || 'Check failed' };
        } catch (err) {
            console.error(err);
            cache[url] = { error: 'Network error' };
        }
        refresh(url);
        notify();
    }

    /**
     * Check many URLs via the bulk endpoint. `skipChecked` leaves URLs that
     * already have a non-error result alone (Content/Redirects "check all"),
     * otherwise everything is re-checked (Links tab, where a fresh sweep is
     * the point).
     */
    async function checkMany(urls, { onProgress = null, skipChecked = false } = {}) {
        const CHUNK = 250; // server caps a single bulk call at 300
        let unique = [...new Set(urls.filter(Boolean))];
        if (skipChecked) unique = unique.filter(u => !cache[u] || cache[u].error || cache[u].bucket === 'blocked');
        if (!unique.length) return 0;

        unique.forEach(u => { cache[u] = { checking: true }; refresh(u); });

        let done = 0;
        for (let i = 0; i < unique.length; i += CHUNK) {
            const batch = unique.slice(i, i + CHUNK);
            try {
                const fd = new FormData();
                fd.append('urls', JSON.stringify(batch));
                const res = await fetch('api/check_links_bulk.php', { method: 'POST', body: fd });
                const json = await res.json();
                if (json.success) {
                    batch.forEach(u => {
                        const info = json.results[u];
                        cache[u] = info
                            ? { status_code: info.status_code, bucket: info.bucket, redirect_url: info.redirect_url }
                            : { error: 'No result' };
                    });
                } else {
                    batch.forEach(u => { cache[u] = { error: json.msg || 'Check failed' }; });
                }
            } catch (err) {
                console.error(err);
                batch.forEach(u => { cache[u] = { error: 'Network error' }; });
            }
            batch.forEach(refresh);
            done += batch.length;
            if (onProgress) onProgress(done, unique.length);
        }
        notify();
        return unique.length;
    }

    /** Run checkMany() behind a button: disable it, show progress, restore its label. */
    async function checkManyWithButton(urls, btn, opts = {}) {
        const idle = btn.textContent;
        btn.disabled = true;
        const n = await checkMany(urls, {
            ...opts,
            onProgress: (done, total) => { btn.textContent = `Checking… (${done}/${total})`; },
        });
        btn.disabled = false;
        btn.textContent = idle;
        return n;
    }

    function stats() {
        let checked = 0, broken = 0;
        Object.values(cache).forEach(s => {
            if (s.checking) return;
            checked++;
            if (s.error || ['broken', 'error', 'blocked'].includes(s.bucket)) broken++;
        });
        return { checked, broken };
    }

    /** One delegated handler: every "Check" / "↻" button on the page. */
    function bind() {
        document.addEventListener('click', e => {
            const btn = e.target.closest('.btn-check-link[data-check-url]');
            if (btn) checkOne(btn.dataset.checkUrl);
        });
    }

    return { cache, bucket, badge, cell, checkOne, checkMany, checkManyWithButton, stats, bind, onChange: fn => listeners.push(fn) };
})();

/* ══════════════════════════ Theme ══════════════════════════ */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('iconMoon').style.display = theme === 'light' ? 'none' : 'block';
    document.getElementById('iconSun').style.display = theme === 'light' ? 'block' : 'none';
}

function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) { /* storage blocked */ }
    applyTheme(stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
        applyTheme(next);
    });
}

/* ══════════════════════════ Site (database) switcher ══════════════════════════
 * Points every tab (list/edit/export, links, redirects, bulk) at a different
 * site's database. Persisted in its own "md_db" cookie - kept separate from
 * the "db" cookie other tools on this domain share, so switching here never
 * affects them (see api/bootstrap.php). Reloads the page so no tab can keep
 * showing (or saving into) the previous site's rows. */

function cookieDir() {
    return location.pathname.replace(/[^/]*$/, '') || '/';
}

function loadDatabaseSwitcher() {
    fetch('api/databases.php')
        .then(r => r.json())
        .then(json => {
            if (!json.success) return;
            document.getElementById('dbSelector').innerHTML = json.databases.map(d =>
                `<option value="${escapeHtml(d.key)}"${d.key === json.current ? ' selected' : ''}>${escapeHtml(d.label)}</option>`
            ).join('');
        })
        .catch(err => console.error('Failed to load database list', err));
}

function bindDatabaseSwitcher() {
    document.getElementById('dbSelector').addEventListener('change', e => {
        if (hasUnsavedContentEdits() && !confirm('You have unsaved Content edits. Switching site discards them. Continue?')) {
            loadDatabaseSwitcher(); // put the dropdown back
            return;
        }
        contentDirty = {}; // already confirmed above - don't let beforeunload ask a second time
        document.cookie = `md_db=${encodeURIComponent(e.target.value)}; path=${cookieDir()}; max-age=${60 * 60 * 24 * 365}`;
        location.reload();
    });
}

/* ---------- filter options (statuses + post types), shared by every tab ---------- */
function loadFilterOptions() {
    return fetch('api/filter_options.php')
        .then(r => r.json())
        .then(json => {
            if (!json.success) throw new Error(json.msg);
            return json;
        })
        .catch(err => {
            console.error('Failed to load filter options', err);
            toast('Failed to load filter options', 'err');
            return { post_types: [], statuses: {} };
        });
}

/* ══════════════════ "Trashed a post -> add a 410?" prompts ══════════════════
 * Shared by the Content tab's status save (single row + bulk save) and the
 * Bulk URL Update tab's status apply. Nothing is written to the Yoast
 * redirect store without an explicit confirm(), the same "ask first"
 * convention as every other write in this tool. */

/** POST to add_redirect.php and return the parsed JSON, or null on a network failure. */
async function submitRedirectRaw(origin, type, target, replace = false) {
    try {
        const res = await fetch('api/add_redirect.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ origin, type, target, replace: replace ? '1' : '' }),
        });
        return await res.json();
    } catch (err) {
        console.error(err);
        return null;
    }
}

/** Single-post prompt (Content tab): confirm, add a 410, offer to replace an existing conflicting rule. */
async function offerTrashRedirect(id, path) {
    const ok = confirm(`Post #${id} was just trashed.\n\nAdd a 410 (Gone) redirect for its old URL?\n\n/${path}/`);
    if (!ok) return;

    const json = await submitRedirectRaw(path, 410, '');
    if (!json) {
        toast('Redirect request failed — check the console/network tab', 'err');
        return;
    }

    if (json.status === 'duplicate') {
        const existing = json.existing;
        const okReplace = confirm(
            `/${path}/ already has a redirect configured (type ${existing.type}${existing.url ? ' → /' + existing.url + '/' : ''}).\n\nReplace it with a 410?`
        );
        if (!okReplace) {
            toast('Redirect left unchanged', '');
            return;
        }
        const replaced = await submitRedirectRaw(path, 410, '', true);
        toast(replaced && replaced.success ? 'Redirect replaced with 410' : (replaced?.msg || 'Redirect not saved'), replaced?.success ? 'ok' : 'err');
        onRedirectsChanged();
        return;
    }

    toast(json.success ? (json.msg || 'Redirect saved') : (json.msg || 'Redirect not saved'), json.success ? 'ok' : 'err');
    if (json.success) onRedirectsChanged();
}

/** Batch prompt (Bulk URL Update tab): one confirm for the whole set, then one follow-up for any conflicts found along the way. */
async function offerBulkTrashRedirects(rows) {
    rows = rows.filter(r => r.path);
    if (!rows.length) return;

    const preview = rows.slice(0, 8).map(r => `• /${r.path}/`).join('\n');
    const more = rows.length > 8 ? `\n…and ${rows.length - 8} more` : '';
    const ok = confirm(`${rows.length} post${rows.length === 1 ? '' : 's'} just trashed.\n\nAdd a 410 (Gone) redirect for each old URL?\n\n${preview}${more}`);
    if (!ok) return;

    let added = 0;
    const duplicates = [];
    for (const r of rows) {
        const json = await submitRedirectRaw(r.path, 410, '');
        if (json && json.status === 'duplicate') duplicates.push(r);
        else if (json && json.success) added++;
    }

    if (added) toast(`Added ${added} redirect${added === 1 ? '' : 's'}`, 'ok');

    if (duplicates.length) {
        const dPreview = duplicates.slice(0, 8).map(r => `• /${r.path}/`).join('\n');
        const dMore = duplicates.length > 8 ? `\n…and ${duplicates.length - 8} more` : '';
        const okReplace = confirm(`${duplicates.length} of those already have a different redirect configured.\n\nReplace ${duplicates.length === 1 ? 'it' : 'them'} with a 410?\n\n${dPreview}${dMore}`);
        if (okReplace) {
            let replaced = 0;
            for (const r of duplicates) {
                const json = await submitRedirectRaw(r.path, 410, '', true);
                if (json && json.success) replaced++;
            }
            toast(`Replaced ${replaced} redirect${replaced === 1 ? '' : 's'}`, 'ok');
        }
    }
    onRedirectsChanged();
}
