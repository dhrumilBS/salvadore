/* ══════════════════════════ Internal links tab ══════════════════════════
 * Two views over one site-wide audit (api/internal_links.php, lib/internal_links.php):
 *
 *  Posts   - every published post with how many other posts link to it (inbound), how many
 *            internal links it gives out, whether it's in a nav menu. "Orphan" = no post links to
 *            it, not in a menu, not the front page. Counts come from post content, FAQ answers and
 *            Elementor layouts; links in PHP templates / footers / widgets aren't in the database.
 *  Retired - internal links to URLs that now 410, redirect (chain followed to its end) or are a
 *            trashed / unpublished post. Matched on the Redirects list, never live-checked.
 *            Fixes go through fixer_write.php (same journal + History undo as the Links tab):
 *            "Point to final" rewrites the href, "Unlink" keeps the text. Links found only in an
 *            Elementor layout can't be rewritten here - they get an "Edit in Elementor" link.
 *
 * Globals: bindInternalTab(), loadInternal(), ilHandleKey(e).
 */
(function () {
    'use strict';

    const st = {
        posts: [], links: [], byId: new Map(),
        mode: 'posts',   // posts | links
        filter: 'orphan_idx', type: '', kind: '', search: '', sort: 'inbound_asc',
        view: [], page: 1, busy: false, home: '', adminUrl: '',
    };
    const $ = id => document.getElementById(id);
    const nextSignal = latestOnly();
    const linkKey = l => `${l.source_id}|${l.source}|${l.meta_key || ''}|${l.href}`;
    const selected = mdSelection({ onChange: () => syncSelection() }); // link keys
    let pager = null;

    const KIND = {
        gone: { badge: 'ls-gone', label: '410 Gone' },
        not_live: { badge: 'badge-trash', label: 'Retired post (404)' },
        redirect: { badge: 'ls-redirect', label: 'Redirects' },
    };
    const isOrphan = p => p.inbound === 0 && !p.is_front && !p.in_menu;
    const path = url => String(url || '').replace(/^https?:\/\/[^/]+/, '') || '/';

    function cols() { return st.mode === 'posts' ? 7 : 6; }
    function showState(msg, isError = false) {
        $('il-body').innerHTML = tableStateRow(cols(), msg, isError ? 'error' : '', { html: true });
    }

    function loadInternal() {
        renderHead();
        showState('<span class="spinner"></span> Reading every published post\'s links…');
        $('il-export-posts').href = apiUrl('internal_links.php', { format: 'csv', mode: 'posts' });
        $('il-export-links').href = apiUrl('internal_links.php', { format: 'csv', mode: 'links' });
        api('internal_links.php', { signal: nextSignal() })
            .then(json => {
                if (!json.success) { st.posts = []; st.links = []; showState(escapeHtml(json.msg || 'Failed to load the audit'), true); return; }
                st.posts = json.posts || [];
                st.links = json.links || [];
                st.home = json.home || '';
                st.adminUrl = json.admin_url || (st.home + '/wp-admin/');
                st.byId = new Map(st.posts.map(p => [p.id, p]));
                selected.prune(st.links.map(linkKey));
                $('il-capped').hidden = !json.capped;
                renderTypeOptions();
                renderKpis();
                applyFilters();
            })
            .catch(err => {
                if (isAbort(err)) return;
                console.error(err);
                showState('Failed to load the audit — check the console/network tab', true);
            });
    }

    function renderKpis() {
        const orphans = st.posts.filter(isOrphan);
        setKpi('il-k-scanned', st.posts.length);
        setKpi('il-k-orphan_idx', orphans.filter(p => p.indexable).length);
        setKpi('il-k-orphan_all', orphans.length);
        setKpi('il-k-weak', st.posts.filter(p => p.indexable && !p.is_front && p.inbound === 1).length);
        setKpi('il-k-links', st.links.length);
        $('il-k-links-hint').textContent = st.links.length
            ? Object.entries(KIND).map(([k, v]) => `${st.links.filter(l => l.kind === k).length} ${v.label.toLowerCase()}`).join(' · ')
            : 'none found';
    }

    function renderTypeOptions() {
        const types = [...new Set(st.posts.map(p => p.post_type))].sort();
        $('il-type').innerHTML = '<option value="">All types</option>'
            + types.map(t => `<option value="${escapeHtml(t)}"${t === st.type ? ' selected' : ''}>${escapeHtml(t)} (${st.posts.filter(p => p.post_type === t).length})</option>`).join('');
    }

    function applyFilters() {
        const q = st.search.toLowerCase();
        if (st.mode === 'posts') {
            const f = {
                '': () => true,
                orphan_idx: p => isOrphan(p) && p.indexable,
                orphan_all: isOrphan,
                weak: p => p.indexable && !p.is_front && p.inbound === 1,
                menu_only: p => p.inbound === 0 && p.in_menu,
            }[st.filter] || (() => true);
            st.view = st.posts.filter(p => f(p) && (!st.type || p.post_type === st.type)
                && (!q || [p.title, p.permalink, String(p.id)].some(v => String(v).toLowerCase().includes(q))));
            const [key, dir] = st.sort.split('_');
            const m = dir === 'asc' ? 1 : -1;
            st.view.sort((a, b) => (a[key === 'out' ? 'outbound' : 'inbound'] - b[key === 'out' ? 'outbound' : 'inbound']) * m || a.title.localeCompare(b.title));
        } else {
            st.view = st.links.filter(l => (!st.kind || l.kind === st.kind)
                && (!q || [l.source_title, l.url, l.anchor, l.final, String(l.source_id)].some(v => String(v || '').toLowerCase().includes(q))));
        }
        render();
    }

    const pageRows = () => st.view.slice((st.page - 1) * pager.perPage, st.page * pager.perPage);

    function renderHead() {
        const posts = st.mode === 'posts';
        $('il-head').innerHTML = posts
            ? `<tr><th>Post</th><th>Indexed</th><th class="num" title="Other published posts that link to it">Inbound posts</th>
                <th class="num" title="Total links pointing at it">Inbound links</th><th class="num" title="Other posts it links to">Links out</th>
                <th>Linked from</th><th class="r-act-col">Actions</th></tr>`
            : `<tr><th class="r-sel-col"><input type="checkbox" id="il-select-all" aria-label="Select all on this page"></th>
                <th>In post</th><th>Link</th><th>Issue</th><th>Ends at</th><th class="r-act-col">Actions</th></tr>`;
        document.querySelectorAll('[data-il-posts]').forEach(el => { el.hidden = !posts; });
        document.querySelectorAll('[data-il-links]').forEach(el => { el.hidden = posts; });
    }

    function postRow(p) {
        const srcs = p.sources.map(id => st.byId.get(id)).filter(Boolean);
        const linkedFrom = srcs.length
            ? srcs.slice(0, 3).map(s => `<a href="${escapeHtml(s.permalink)}" target="_blank" rel="noopener" title="${escapeHtml(s.permalink)}">${escapeHtml(truncate(s.title, 40))}</a>`).join('<br>')
                + (srcs.length > 3 ? `<br><span class="col-note" title="${escapeHtml(srcs.slice(3).map(s => s.title).join('\n'))}">+${srcs.length - 3} more</span>` : '')
            : (p.is_front ? '<span class="col-note">front page</span>'
                : p.in_menu ? '<span class="badge badge-neutral" title="Linked from a navigation menu only">menu only</span>'
                    : '<span class="badge ls-gone" title="No published post links to it and it isn\'t in a menu">orphan</span>');
        const tags = [p.is_front ? '<span class="badge badge-publish">front page</span>' : '', p.in_menu ? '<span class="badge badge-neutral">in menu</span>' : ''].join(' ');
        return `<tr>
            <td class="il-post"><div class="il-title">${escapeHtml(truncate(p.title || '(no title)', 80))}</div>
                <div class="il-meta"><span class="col-note">#${p.id} · ${escapeHtml(p.post_type)}</span> ${tags}</div>${urlCellHtml(p.permalink, path(p.permalink))}</td>
            <td>${p.indexable ? '<span class="badge badge-publish">yes</span>' : '<span class="badge badge-draft" title="noindex - hidden from search, so few links is expected">noindex</span>'}</td>
            <td class="num"><b class="${p.inbound === 0 ? 'il-zero' : ''}">${fmtNum(p.inbound)}</b></td>
            <td class="num">${fmtNum(p.inbound_links)}</td>
            <td class="num">${fmtNum(p.outbound)}</td>
            <td class="il-from">${linkedFrom}</td>
            <td class="r-act-col"><span class="r-row-actions">
                ${p.inbound ? `<a class="btn small" href="#fixer?find=${encodeURIComponent(p.permalink)}" title="Open the Links tab with every link to this post">See links</a>` : ''}
                <a class="btn small" href="${escapeHtml(st.adminUrl)}post.php?post=${p.id}&action=edit" target="_blank" rel="noopener" title="Open in WordPress to add links">Edit ↗</a>
            </span></td>
        </tr>`;
    }

    function linkRow(l) {
        const key = linkKey(l);
        const sel = selected.has(key);
        const k = KIND[l.kind];
        const elementor = l.source === 'elementor';
        const rule = l.rule_type ? `${l.rule_type}${l.rule_url ? ' → /' + escapeHtml(l.rule_url) + '/' : ''}${l.hops > 1 ? ` · ${l.hops} hops` : ''}` : escapeHtml(l.target_title || '');
        const field = l.source === 'faq' ? `FAQ field ${escapeHtml(l.meta_key)}` : elementor ? 'Elementor layout' : 'post content';
        return `<tr data-il-key="${escapeHtml(key)}"${sel ? ' class="r-selected"' : ''}>
            <td class="r-sel-col">${elementor ? '' : `<input type="checkbox" class="il-row-cb" ${sel ? 'checked' : ''} aria-label="Select this link">`}</td>
            <td class="il-post"><div class="il-title">${escapeHtml(truncate(l.source_title || '(no title)', 70))}</div>
                <div class="il-meta"><span class="col-note">#${l.source_id} · ${field}${l.count > 1 ? ` · ${l.count}×` : ''}</span></div>${urlCellHtml(l.source_permalink, path(l.source_permalink))}</td>
            <td class="url-col"><div class="il-anchor">“${escapeHtml(truncate(l.anchor, 60))}”</div>${urlCellHtml(l.url, path(l.url))}</td>
            <td><span class="badge ${k.badge}">${k.label}</span><div class="il-reason">${rule}</div></td>
            <td class="url-col">${l.final ? urlCellHtml(l.final, path(l.final)) : `<span class="col-note">${l.kind === 'redirect' ? 'no safe target' : 'unlink it'}</span>`}</td>
            <td class="r-act-col"><span class="r-row-actions">${elementor
                ? `<a class="btn small" href="${escapeHtml(st.adminUrl)}post.php?post=${l.source_id}&action=elementor" target="_blank" rel="noopener" title="This link is in an Elementor widget - fix it in Elementor">Edit in Elementor ↗</a>`
                : `${l.final ? '<button type="button" class="btn small" data-il-act="final" title="Rewrite this link to where it ends up">Point to final</button>' : ''}
                   <button type="button" class="btn small danger" data-il-act="unlink" title="Remove the link, keep its text">Unlink</button>`}
            </span></td>
        </tr>`;
    }

    function render() {
        st.page = pager.render({ page: st.page, total: st.view.length });
        const rows = pageRows();
        if (!st.posts.length) showState('No published posts on this site.');
        else if (!rows.length) {
            showState(st.mode === 'links'
                ? (st.links.length ? 'No links match the current filters/search.' : '✓ No internal link points at a 410, a redirected URL or a retired post.')
                : 'No posts match the current filters/search.');
        } else {
            $('il-body').innerHTML = rows.map(st.mode === 'posts' ? postRow : linkRow).join('');
        }
        $('il-st-total').textContent = fmtNum(st.view.length);
        document.querySelectorAll('#il-stats .stat-card').forEach(c => {
            const on = c.dataset.ilMode === st.mode && (st.mode === 'links' || c.dataset.ilFilter === st.filter);
            c.classList.toggle('active', on);
        });
        syncSelection();
    }

    function syncSelection() {
        const n = selected.size;
        $('il-bulk').hidden = st.mode !== 'links' || n === 0;
        $('il-sel-count').textContent = fmtNum(n);
        const withFinal = selectedLinks().filter(l => l.final).length;
        $('il-bulk-final').disabled = !withFinal;
        const all = $('il-select-all');
        if (all) selected.syncHeader(all, pageRows().filter(l => l.source !== 'elementor').map(linkKey));
    }

    const selectedLinks = () => st.links.filter(l => selected.has(linkKey(l)));

    /* ---------- writes (fixer_write.php: journaled, undo in History) ---------- */

    async function fixLinks(links, op) {
        if (st.busy) return;
        links = links.filter(l => l.source !== 'elementor' && (op === 'unlink' || l.final));
        if (!links.length) return;
        const ok = await confirmDialog({
            title: op === 'unlink' ? `Unlink ${pluralize(links.length, 'link')}?` : `Point ${pluralize(links.length, 'link')} at the final URL?`,
            message: op === 'unlink'
                ? 'The link is removed; its text stays where it is. History can undo this per post.'
                : 'Each link is rewritten to where its redirect ends, so visitors and Google skip the redirect. History can undo this per post.',
            changes: links.map(l => ({ post: `#${l.source_id} ${l.source_title}`, from: l.url, to: op === 'unlink' ? '' : l.final, toLabel: `link removed — “${truncate(l.anchor, 40)}” kept` })),
            okLabel: op === 'unlink' ? `Unlink ${pluralize(links.length, 'link')}` : `Update ${pluralize(links.length, 'link')}`,
            tone: op === 'unlink' ? 'danger' : 'primary',
        });
        if (!ok) return;

        st.busy = true;
        let json;
        try {
            json = await api('fixer_write.php', {
                method: 'POST',
                body: new URLSearchParams({
                    op: op === 'unlink' ? 'unlink' : 'replace',
                    items: JSON.stringify(links.map(l => ({ post_id: l.source_id, href: l.href, source: l.source, meta_key: l.meta_key, new_url: op === 'unlink' ? undefined : l.final }))),
                }),
            });
        } catch (err) {
            console.error(err);
            json = { success: false, msg: 'Request failed — check the console/network tab' };
        }
        st.busy = false;
        if (!json.success) { toast(json.msg || 'Not saved', 'err'); return; }
        const failed = (json.results || []).map((r, i) => [r, links[i]]).filter(([r]) => !['updated', 'removed'].includes(r.status));
        if (failed.length) alertDialog(`${json.done} of ${links.length} fixed`, 'These were not changed:', failed.map(([r, l]) => `#${l.source_id} ${l.url}: ${r.message || r.status}`));
        else toast(json.msg || 'Saved', 'ok');
        selected.clear();
        refreshHistoryCount();
        onLinksChanged();
        loadInternal();
    }

    /* ---------- wiring ---------- */

    function setMode(mode, filter) {
        st.mode = mode;
        if (filter !== undefined) st.filter = filter;
        $('il-mode').value = st.mode;
        $('il-filter').value = st.filter;
        st.page = 1;
        renderHead();
        applyFilters();
    }

    function bindInternalTab() {
        pager = mdPager('il-pager', {
            sizes: [50, 100, 250], perPage: 100, noun: 'row', storeKey: 'il.perPage',
            onPage: p => { st.page = p; render(); },
        });
        $('il-mode').addEventListener('change', e => setMode(e.target.value));
        $('il-filter').addEventListener('change', e => { st.filter = e.target.value; st.page = 1; applyFilters(); });
        $('il-type').addEventListener('change', e => { st.type = e.target.value; st.page = 1; applyFilters(); });
        $('il-sort').addEventListener('change', e => { st.sort = e.target.value; applyFilters(); });
        $('il-kind').addEventListener('change', e => { st.kind = e.target.value; st.page = 1; applyFilters(); });
        $('il-search').addEventListener('input', debounce(e => { st.search = e.target.value.trim(); st.page = 1; applyFilters(); }, 200));
        $('il-refresh').addEventListener('click', loadInternal);

        // KPI cards switch view + filter; clicking the active one shows everything again.
        $('il-stats').addEventListener('click', e => {
            const card = e.target.closest('.stat-card');
            if (!card) return;
            const off = card.classList.contains('active') && card.dataset.ilMode === 'posts';
            setMode(card.dataset.ilMode, card.dataset.ilMode === 'posts' ? (off ? '' : card.dataset.ilFilter) : undefined);
        });

        $('il-table').addEventListener('change', e => {
            if (e.target.id === 'il-select-all') {
                selected.setMany(pageRows().filter(l => l.source !== 'elementor').map(linkKey), e.target.checked);
                render();
                return;
            }
            const cb = e.target.closest('.il-row-cb');
            if (!cb) return;
            const tr = cb.closest('tr');
            selected.toggle(tr.dataset.ilKey, cb.checked);
            tr.classList.toggle('r-selected', cb.checked);
        });
        $('il-body').addEventListener('click', e => {
            const btn = e.target.closest('[data-il-act]');
            if (!btn) return;
            const l = st.links.find(x => linkKey(x) === btn.closest('tr').dataset.ilKey);
            if (l) fixLinks([l], btn.dataset.ilAct);
        });
        $('il-bulk-final').addEventListener('click', () => fixLinks(selectedLinks(), 'final'));
        $('il-bulk-unlink').addEventListener('click', () => fixLinks(selectedLinks(), 'unlink'));
        $('il-bulk-clear').addEventListener('click', () => { selected.clear(); render(); });
    }

    /** r = refresh, ←/→ = page. Nothing while typing. */
    function ilHandleKey(e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'r') { loadInternal(); return true; }
        if (e.key === 'ArrowRight' && st.page < pager.pages) { st.page++; render(); return true; }
        if (e.key === 'ArrowLeft' && st.page > 1) { st.page--; render(); return true; }
        return false;
    }

    /** Open on a given posts filter (Overview task launcher). */
    function ilPreset(filter, mode = 'posts') {
        st.filter = filter || '';
        if (pager) setMode(mode, st.filter);
    }

    window.ilPreset = ilPreset;
    window.bindInternalTab = bindInternalTab;
    window.loadInternal = loadInternal;
    window.ilHandleKey = ilHandleKey;
})();
