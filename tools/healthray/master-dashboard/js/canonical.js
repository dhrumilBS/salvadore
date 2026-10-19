/* ══════════════════════════ Canonicals tab ══════════════════════════
 * Site-wide report of Yoast canonical URLs (`_yoast_wpseo_canonical`) that
 * point somewhere that no longer answers 200: a URL with a 410/451 rule, a
 * 301/302/307 rule (chains followed to the final URL), a trashed/unpublished
 * post, or - informational - nothing at all (live-check to confirm).
 * api/canonical_report.php does the matching (same redirect store + post
 * resolver as the Redirects tab); filtering, paging and selection are
 * client-side over that one result.
 *
 * Fixes: "Remove" deletes the canonical (the post falls back to its own URL),
 * "Use target" sets it to the end of the redirect chain. Both go through
 * confirmDialog() and canonical_fix.php, which refuses the whole batch if any
 * canonical changed since this report was loaded. Undo is in History.
 *
 * Globals: bindCanonicalTab(), loadCanonicals(), cnHandleKey(e).
 */
(function () {
    'use strict';

    const st = {
        rows: [],
        view: [],
        counts: {},
        scanned: 0,
        kind: '',
        scope: '',
        search: '',
        page: 1,
        busy: false,
    };
    const $ = id => document.getElementById(id);
    const nextSignal = latestOnly();
    const selected = mdSelection({ onChange: () => syncSelection() }); // post ids
    let pager = null;

    const KIND_BADGE = { gone: 'ls-gone', redirect: 'ls-redirect', not_live: 'badge-trash', unmatched: 'badge-neutral' };
    const KIND_SHORT = { gone: '410 Gone', redirect: 'Redirect', not_live: 'Retired post', unmatched: 'Unmatched' };

    function showState(msg, isError = false) {
        $('cn-body').innerHTML = tableStateRow(7, msg, isError ? 'error' : '', { html: true });
    }

    function loadCanonicals() {
        $('cn-body').innerHTML = tableStateRow(7, 'Auditing canonical URLs…', 'loading');
        $('cn-export').href = apiUrl('canonical_report.php', { format: 'csv' });
        api('canonical_report.php', { signal: nextSignal() })
            .then(json => {
                if (!json.success) { st.rows = []; showState(escapeHtml(json.msg || 'Failed to load the report'), true); return; }
                st.rows = json.rows || [];
                st.counts = json.counts || {};
                st.scanned = json.scanned || 0;
                selected.prune(st.rows.map(r => r.id));
                renderKpis();
                applyFilters();
            })
            .catch(err => {
                if (isAbort(err)) return;
                console.error(err);
                st.rows = [];
                showState('Failed to load the report — check the console/network tab', true);
            });
    }

    function renderKpis() {
        setKpi('cn-k-live', st.rows.filter(r => r.live && r.kind !== 'unmatched').length);
        ['gone', 'redirect', 'not_live', 'unmatched'].forEach(k => setKpi('cn-k-' + k, st.counts[k] || 0));
        $('cn-k-scanned').textContent = `of ${fmtNum(st.scanned)} posts with a canonical`;
    }

    function applyFilters() {
        const q = st.search.toLowerCase();
        st.view = st.rows.filter(r =>
            (!st.kind || r.kind === st.kind)
            && (!st.scope || (st.scope === 'live') === r.live)
            && (!q || [r.title, r.permalink, r.canonical, r.reason, r.suggested, String(r.id)].some(v => String(v || '').toLowerCase().includes(q))));
        render();
    }

    const pageRows = () => st.view.slice((st.page - 1) * pager.perPage, st.page * pager.perPage);

    function rowHtml(r) {
        const sel = selected.has(r.id);
        const statusCls = r.live ? 'badge-publish' : 'badge-draft';
        return `<tr data-cn-id="${r.id}"${sel ? ' class="r-selected"' : ''}>
            <td class="r-sel-col"><input type="checkbox" class="cn-row-cb" ${sel ? 'checked' : ''} aria-label="Select post #${r.id}"></td>
            <td class="cn-post">
                <div class="cn-title">${escapeHtml(truncate(decodeEntities(r.title) || '(no title)', 80))}</div>
                <div class="cn-meta"><span class="col-note">#${r.id} · ${escapeHtml(r.post_type)}</span> <span class="badge ${statusCls}">${escapeHtml(r.status)}</span></div>
                ${urlCellHtml(r.permalink)}
            </td>
            <td class="url-col">${urlCellHtml(r.canonical)}</td>
            <td class="cn-issue"><span class="badge ${KIND_BADGE[r.kind] || 'badge-neutral'}">${escapeHtml(KIND_SHORT[r.kind] || r.kind)}</span>
                <div class="cn-reason">${escapeHtml(r.reason || '')}</div></td>
            <td class="url-col">${r.suggested ? urlCellHtml(r.suggested) : `<span class="col-note">${r.kind === 'unmatched' ? '—' : 'remove canonical'}</span>`}</td>
            <td>${LinkStatus.cell(r.canonical)}</td>
            <td class="r-act-col"><span class="r-row-actions">
                ${r.suggested ? '<button type="button" class="btn small" data-cn-act="target" title="Set the canonical to the end of the redirect chain">Use target</button>' : ''}
                <button type="button" class="btn small danger" data-cn-act="remove" title="Delete the canonical - the post points at its own URL">Remove</button>
            </span></td>
        </tr>`;
    }

    function render() {
        st.page = pager.render({ page: st.page, total: st.view.length });
        const rows = pageRows();
        if (!st.rows.length) {
            showState(st.scanned
                ? `✓ None of the ${fmtNum(st.scanned)} canonical URLs on this site redirect, are gone, or point at a retired post.`
                : 'No post on this site sets a custom canonical URL.');
        } else if (!rows.length) {
            showState('No issues match the current filters/search.');
        } else {
            $('cn-body').innerHTML = rows.map(rowHtml).join('');
        }
        $('cn-st-total').textContent = fmtNum(st.view.length);
        document.querySelectorAll('#cn-stats .stat-card').forEach(c => {
            const on = c.dataset.cnScope === 'live' ? (st.scope === 'live' && !st.kind) : (c.dataset.cnKind === st.kind && !!st.kind);
            c.classList.toggle('active', on);
        });
        syncSelection();
    }

    function syncSelection() {
        const n = selected.size;
        $('cn-bulk').hidden = n === 0;
        $('cn-sel-count').textContent = fmtNum(n);
        const withTarget = st.rows.filter(r => selected.has(r.id) && r.suggested).length;
        $('cn-bulk-target').disabled = !withTarget;
        $('cn-bulk-target').textContent = withTarget && withTarget < n ? `Use redirect target (${fmtNum(withTarget)})` : 'Use redirect target';
        selected.syncHeader($('cn-select-all'), pageRows().map(r => r.id));
    }

    /* ---------- writes ---------- */

    /** rows + mode ('remove' | 'target') -> confirm -> canonical_fix.php -> reload. */
    async function fixRows(rows, mode) {
        if (st.busy) return;
        if (mode === 'target') rows = rows.filter(r => r.suggested);
        if (!rows.length) return;
        const live = rows.filter(r => r.live).length;
        const ok = await confirmDialog({
            title: mode === 'remove' ? `Remove ${pluralize(rows.length, 'canonical URL')}?` : `Point ${pluralize(rows.length, 'canonical')} at the redirect target?`,
            message: (mode === 'remove'
                ? 'Each post falls back to its own URL as canonical (what Yoast does when the field is empty).'
                : 'Each canonical is set to the URL its redirect chain ends at.')
                + (live ? ` ${fmtNum(live)} of these ${live === 1 ? 'post is' : 'posts are'} live.` : '')
                + ' History can undo this.',
            changes: rows.map(r => ({
                post: `#${r.id} ${decodeEntities(r.title)} (${r.status})`,
                from: r.canonical,
                to: mode === 'remove' ? '' : r.suggested,
                toLabel: 'canonical removed',
            })),
            okLabel: mode === 'remove' ? `Remove ${pluralize(rows.length, 'canonical')}` : `Update ${pluralize(rows.length, 'canonical')}`,
            tone: mode === 'remove' ? 'danger' : 'primary',
        });
        if (!ok) return;

        st.busy = true;
        const res = await submitCanonicalFix(rows.map(r => ({ post_id: r.id, expected: r.canonical, canonical: mode === 'remove' ? '' : r.suggested })));
        st.busy = false;
        if (!res) { toast('Request failed — check the console/network tab', 'err'); return; }
        if (!res.success) {
            await alertDialog('Nothing was saved', res.msg || 'The canonicals could not be updated.', (res.errors || []).map(e => e.message));
            loadCanonicals(); // a conflict means the report is stale
            return;
        }
        toast(res.msg, 'ok');
        selected.setMany(rows.map(r => r.id), false);
        loadCanonicals();
    }

    const selectedRows = () => st.rows.filter(r => selected.has(r.id));

    /* ---------- wiring ---------- */

    function bindCanonicalTab() {
        pager = mdPager('cn-pager', {
            sizes: [50, 100, 250], perPage: 100, noun: 'issue', storeKey: 'cn.perPage',
            onPage: p => { st.page = p; render(); },
        });
        $('cn-search').addEventListener('input', debounce(e => { st.search = e.target.value.trim(); st.page = 1; applyFilters(); }, 200));
        $('cn-kind').addEventListener('change', e => { st.kind = e.target.value; st.page = 1; applyFilters(); });
        $('cn-scope').addEventListener('change', e => { st.scope = e.target.value; st.page = 1; applyFilters(); });
        $('cn-refresh').addEventListener('click', loadCanonicals);
        $('cn-check-page').addEventListener('click', e => {
            LinkStatus.checkManyWithButton(pageRows().map(r => r.canonical), e.currentTarget, { skipChecked: true });
        });

        // KPI cards are filter shortcuts; clicking the active one clears it.
        $('cn-stats').addEventListener('click', e => {
            const card = e.target.closest('.stat-card');
            if (!card) return;
            const toggleOff = card.classList.contains('active');
            st.kind = toggleOff ? '' : (card.dataset.cnKind || '');
            st.scope = toggleOff ? '' : (card.dataset.cnScope || '');
            $('cn-kind').value = st.kind;
            $('cn-scope').value = st.scope;
            st.page = 1;
            applyFilters();
        });

        $('cn-body').addEventListener('change', e => {
            const cb = e.target.closest('.cn-row-cb');
            if (!cb) return;
            const tr = cb.closest('tr');
            selected.toggle(Number(tr.dataset.cnId), cb.checked);
            tr.classList.toggle('r-selected', cb.checked);
        });
        $('cn-body').addEventListener('click', e => {
            const btn = e.target.closest('[data-cn-act]');
            if (!btn) return;
            const row = st.rows.find(r => r.id === Number(btn.closest('tr').dataset.cnId));
            if (row) fixRows([row], btn.dataset.cnAct);
        });
        $('cn-select-all').addEventListener('change', e => {
            selected.setMany(pageRows().map(r => r.id), e.target.checked);
            render();
        });
        $('cn-bulk-remove').addEventListener('click', () => fixRows(selectedRows(), 'remove'));
        $('cn-bulk-target').addEventListener('click', () => fixRows(selectedRows(), 'target'));
        $('cn-bulk-clear').addEventListener('click', () => { selected.clear(); render(); });
    }

    /** r = refresh, ←/→ = page. Nothing while typing. */
    function cnHandleKey(e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'r') { loadCanonicals(); return true; }
        if (e.key === 'ArrowRight' && st.page < pager.pages) { st.page++; render(); return true; }
        if (e.key === 'ArrowLeft' && st.page > 1) { st.page--; render(); return true; }
        return false;
    }

    window.bindCanonicalTab = bindCanonicalTab;
    window.loadCanonicals = loadCanonicals;
    window.cnHandleKey = cnHandleKey;
})();
