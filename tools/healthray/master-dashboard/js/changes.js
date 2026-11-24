/* ══════════════════════════ Recent changes tab ══════════════════════════
 * Posts modified in the last N days and HOW (api/recent_changes.php, lib/recent_changes.php):
 *   dashboard - matches an entry in this dashboard's History
 *   editor    - WordPress saved a revision at the same time (WP editor / Elementor); "who" = its author
 *   unknown   - no revision, no History entry: plugin, import, cron, script or a direct DB write
 * Bulk changes (10+ posts in one minute) are listed as cards on top; "also on" = the same minute on another
 * site, which points at a server-level job. Read-only.
 *
 * Globals: bindChangesTab(), loadChanges(), rcHandleKey(e).
 */
(function () {
    'use strict';

    const DW_RC_BULK_MIN = 10; // posts in one minute = a bulk change - keep in step with lib/recent_changes.php
    const st = { rows: [], batches: [], view: [], days: 7, via: '', type: '', batch: '', search: '', page: 1, adminUrl: '' };
    const $ = id => document.getElementById(id);
    const nextSignal = latestOnly();
    let pager = null;

    const VIA = {
        dashboard: { badge: 'badge-publish', label: 'Dashboard', tip: 'Matches an entry in this dashboard\'s History' },
        editor: { badge: 'badge-neutral', label: 'WP editor', tip: 'WordPress saved a revision at the same time (editor / Elementor save)' },
        unknown: { badge: 'badge-draft', label: 'No revision', tip: 'No revision and no dashboard entry: a plugin, import, cron job, script or direct database edit. Post types without revisions also land here when edited in WP admin.' },
    };
    const path = url => String(url || '').replace(/^https?:\/\/[^/]+/, '') || '/';

    function showState(msg, isError = false) {
        $('rc-body').innerHTML = tableStateRow(6, msg, isError ? 'error' : '', { html: true });
    }

    function loadChanges() {
        showState('<span class="spinner"></span> Reading recent changes…');
        $('rc-export').href = apiUrl('recent_changes.php', { days: st.days, format: 'csv' });
        api('recent_changes.php', { params: { days: st.days }, signal: nextSignal() })
            .then(json => {
                if (!json.success) { st.rows = []; showState(escapeHtml(json.msg || 'Failed to load'), true); return; }
                st.rows = json.changes || [];
                st.batches = json.batches || [];
                st.adminUrl = json.admin_url || '';
                if (st.batch && !st.batches.some(b => b.minute_gmt === st.batch)) st.batch = '';
                $('rc-capped').hidden = !json.capped;
                setKpi('rc-k-total', st.rows.length);
                setKpi('rc-k-bulk', st.batches.length);
                $('rc-k-bulk-hint').textContent = st.batches.length ? `${fmtNum(st.batches.reduce((n, b) => n + b.count, 0))} posts in them` : 'none';
                setKpi('rc-k-unknown', st.rows.filter(r => r.via === 'unknown').length);
                setKpi('rc-k-dashboard', st.rows.filter(r => r.via === 'dashboard').length);
                setKpi('rc-k-editor', st.rows.filter(r => r.via === 'editor').length);
                const who = [...new Set(st.rows.map(r => r.who).filter(Boolean))];
                $('rc-k-editor-hint').textContent = who.length ? truncate(who.join(', '), 60) : 'nobody';
                setKpi('rc-k-uploads', json.uploads || 0);
                renderTypes();
                renderBatches();
                applyFilters();
            })
            .catch(err => {
                if (isAbort(err)) return;
                console.error(err);
                showState('Failed to load — check the console/network tab', true);
            });
    }

    function renderTypes() {
        const types = [...new Set(st.rows.map(r => r.post_type))].sort();
        $('rc-type').innerHTML = '<option value="">All types</option>' + types.map(t =>
            `<option value="${escapeHtml(t)}"${t === st.type ? ' selected' : ''}>${escapeHtml(t)} (${st.rows.filter(r => r.post_type === t).length})</option>`).join('');
    }

    function renderBatches() {
        const wrap = $('rc-batches');
        if (!st.batches.length) {
            wrap.innerHTML = `<p class="col-note">No bulk change (${DW_RC_BULK_MIN}+ posts in one minute) in the last ${pluralize(st.days, 'day')}.</p>`;
            return;
        }
        wrap.innerHTML = st.batches.map(b => {
            const via = Object.entries(b.via).map(([k, n]) => `<span class="badge ${VIA[k].badge}" title="${escapeHtml(VIA[k].tip)}">${VIA[k].label} ${fmtNum(n)}</span>`).join(' ');
            const types = Object.entries(b.types).map(([t, n]) => `${escapeHtml(t)} ${fmtNum(n)}`).join(' · ');
            const unexplained = (b.via.unknown || 0) > 0;
            const also = (b.also_on || []).map(a => `<span class="badge ls-redirect" title="The same minute on another site - points at a server-level job">also ${escapeHtml(a.site)}: ${fmtNum(a.count)}</span>`).join(' ');
            return `<button type="button" class="rc-batch${unexplained ? ' is-unknown' : ''}${st.batch === b.minute_gmt ? ' active' : ''}" data-rc-batch="${escapeHtml(b.minute_gmt)}" title="Show only these posts">
                <div class="rc-batch-top"><b>${escapeHtml(b.modified)}</b> <span class="col-note">site time · ${escapeHtml(b.minute_gmt)} UTC</span></div>
                <div class="rc-batch-n">${fmtNum(b.count)} posts${b.same_second ? ' <span class="col-note">in the same second</span>' : ''}</div>
                <div class="rc-batch-meta">${via} ${also}</div>
                <div class="rc-batch-types">${types}</div>
            </button>`;
        }).join('');
    }

    function applyFilters() {
        const q = st.search.toLowerCase();
        st.view = st.rows.filter(r => (!st.via || r.via === st.via) && (!st.type || r.post_type === st.type) && (!st.batch || r.batch === st.batch)
            && (!q || [r.title, r.permalink, String(r.id), r.who, r.note, r.last_editor].some(v => String(v || '').toLowerCase().includes(q))));
        $('rc-batch-clear').hidden = !st.batch;
        render();
    }

    const pageRows = () => st.view.slice((st.page - 1) * pager.perPage, st.page * pager.perPage);

    function rowHtml(r) {
        const v = VIA[r.via];
        const who = r.via === 'dashboard'
            ? `<span class="col-note" title="${escapeHtml(r.note)}">${escapeHtml(truncate(r.note, 70))}</span>`
            : r.who ? escapeHtml(r.who)
                : `<span class="col-note" title="The last person who saved it in WP admin - not necessarily this change">${r.last_editor ? 'last WP editor: ' + escapeHtml(r.last_editor) : '—'}</span>`;
        return `<tr>
            <td class="rc-when"><div>${escapeHtml(r.modified.slice(0, 16))}</div><div class="col-note">${escapeHtml(r.modified_gmt.slice(11, 16))} UTC</div></td>
            <td class="rc-post"><div class="rc-title">${escapeHtml(truncate(r.title || '(no title)', 80))}</div>
                <div class="col-note">#${r.id} · ${escapeHtml(r.post_type)} · ${escapeHtml(r.status)}</div>
                ${r.permalink ? urlCellHtml(r.permalink, path(r.permalink)) : ''}</td>
            <td><span class="badge ${v.badge}" title="${escapeHtml(v.tip)}">${v.label}</span></td>
            <td class="rc-who">${who}</td>
            <td>${r.batch ? `<button type="button" class="btn small" data-rc-batch="${escapeHtml(r.batch)}" title="Show the whole bulk change">bulk ${escapeHtml(r.batch.slice(11))}</button>` : ''}</td>
            <td class="r-act-col">${st.adminUrl ? `<a class="btn small" href="${escapeHtml(st.adminUrl)}post.php?post=${r.id}&action=edit" target="_blank" rel="noopener" title="Open in WordPress (revisions are in the sidebar)">Edit ↗</a>` : ''}</td>
        </tr>`;
    }

    function render() {
        st.page = pager.render({ page: st.page, total: st.view.length });
        const rows = pageRows();
        if (!st.rows.length) showState(`Nothing was modified in the last ${pluralize(st.days, 'day')}.`);
        else if (!rows.length) showState('No changes match the current filters/search.');
        else $('rc-body').innerHTML = rows.map(rowHtml).join('');
        $('rc-st-total').textContent = fmtNum(st.view.length);
        document.querySelectorAll('#rc-stats .stat-card').forEach(c => c.classList.toggle('active', !!c.dataset.rcVia && c.dataset.rcVia === st.via));
        document.querySelectorAll('#rc-batches .rc-batch').forEach(c => c.classList.toggle('active', c.dataset.rcBatch === st.batch));
    }

    function setBatch(minute) {
        st.batch = st.batch === minute ? '' : minute;
        st.page = 1;
        applyFilters();
    }

    function bindChangesTab() {
        pager = mdPager('rc-pager', { sizes: [50, 100, 250], perPage: 100, noun: 'change', storeKey: 'rc.perPage', onPage: p => { st.page = p; render(); } });
        $('rc-days').addEventListener('change', e => { st.days = Number(e.target.value) || 7; st.page = 1; loadChanges(); });
        $('rc-via').addEventListener('change', e => { st.via = e.target.value; st.page = 1; applyFilters(); });
        $('rc-type').addEventListener('change', e => { st.type = e.target.value; st.page = 1; applyFilters(); });
        $('rc-search').addEventListener('input', debounce(e => { st.search = e.target.value.trim(); st.page = 1; applyFilters(); }, 200));
        $('rc-refresh').addEventListener('click', loadChanges);
        $('rc-batch-clear').addEventListener('click', () => setBatch(st.batch));
        $('rc-stats').addEventListener('click', e => {
            const card = e.target.closest('.stat-card');
            if (!card || card.dataset.rcVia === undefined) return;
            st.via = st.via === card.dataset.rcVia ? '' : card.dataset.rcVia;
            $('rc-via').value = st.via;
            st.page = 1;
            applyFilters();
        });
        document.getElementById('changesView').addEventListener('click', e => {
            const b = e.target.closest('[data-rc-batch]');
            if (b) setBatch(b.dataset.rcBatch);
        });
    }

    function rcHandleKey(e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'r') { loadChanges(); return true; }
        if (e.key === 'ArrowRight' && st.page < pager.pages) { st.page++; render(); return true; }
        if (e.key === 'ArrowLeft' && st.page > 1) { st.page--; render(); return true; }
        return false;
    }

    window.bindChangesTab = bindChangesTab;
    window.loadChanges = loadChanges;
    window.rcHandleKey = rcHandleKey;
})();
