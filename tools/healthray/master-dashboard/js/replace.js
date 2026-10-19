/* ══════════════════════════ Find & Replace tab ══════════════════════════
 * Ported from the standalone ../replace/ tool. Search first (read-only
 * preview of every match, grouped by post), pick fields, then Replace after a
 * confirmDialog() naming the site. Every replace is backed up server-side
 * (api/replace_apply.php) and can be undone (inline Undo, or the shared History
 * drawer filtered to Find & Replace) as long as the field still holds what we wrote.
 *
 * Globals exposed (everything else stays inside this IIFE):
 *   bindReplaceTab()  attach listeners (once, before the site is known)
 *   loadReplace()     first show / reload: site info, prefs
 *   frHandleKey(e)    every keydown while this tab is active; true = handled
 *   frHasUnsaved()    a search result has selected, not-yet-replaced fields
 *   frReadHash(q)     "find=...&replace=..." -> prefill + auto-search
 */
(() => {
    const $ = id => document.getElementById(id);
    const esc = escapeHtml;
    const plural = (n, one, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`;
    const store = { get: (k, d) => mdStore.get(k, d) ?? d, set: (k, v) => mdStore.set(k, v) };

    const PAGE = 60;                                  // posts rendered per "Show more"
    const ALL_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];
    const ELEMENTOR_SITES = /^(landing|botphonic)$/;  // sites built with Elementor
    const SEO_NAMES = {
        _yoast_wpseo_title: 'SEO title', _yoast_wpseo_metadesc: 'Meta description', _yoast_wpseo_focuskw: 'Focus keyphrase',
        _yoast_wpseo_canonical: 'Canonical URL', '_yoast_wpseo_opengraph-title': 'Social title', '_yoast_wpseo_opengraph-description': 'Social description',
        '_yoast_wpseo_twitter-title': 'X title', '_yoast_wpseo_twitter-description': 'X description', _yoast_wpseo_bctitle: 'Breadcrumb title',
    };

    let info = null;          // api/replace_site.php for the pinned site
    let result = null;        // last search response
    let searched = null;      // options the shown results were found with
    let selected = new Set(); // field keys "kind:id"
    let done = new Set();     // field keys already replaced
    let viewScope = '';       // results filter: scope key or ''
    let viewText = '';
    let shown = PAGE;
    let lastOp = null;        // last replace response (for the Undo notice)
    let busy = false;         // a replace / undo request is in flight
    let pendingSearch = false; // frReadHash() ran before the site info was loaded
    let loading = null;        // in-flight loadReplace() promise

    const nextSearchSignal = latestOnly();
    const nextSiteSignal = latestOnly();

    const key = f => `${f.kind}:${f.id}`;
    const siteLabel = () => info?.label || siteList.find(d => d.key === SITE)?.label || SITE;
    const prefsKey = () => `fr.prefs.${SITE}`;

    /* ───── API ───── */
    async function call(path, opts = {}) {
        let json;
        try {
            json = await api(path, opts);
        } catch (e) {
            if (isAbort(e)) throw e;
            throw new Error('Could not reach the server (or it returned an error page). Check the database connection.');
        }
        if (!json || !json.success) {
            const err = new Error(json?.msg || 'Something went wrong.');
            err.data = json;
            throw err;
        }
        return json;
    }
    const post = (path, body, signal) => call(path, { method: 'POST', body: JSON.stringify(body), signal });

    /* ───── Site + form setup ───── */
    async function loadReplace() {
        if (loading) return loading;
        loading = (async () => {
            $('fr-site-label').textContent = siteLabel();
            try {
                info = await call('replace_site.php', { signal: nextSiteSignal() });
            } catch (e) {
                if (isAbort(e)) return;
                info = null;
                $('fr-results').innerHTML = emptyHtml('Can\'t connect to this site\'s database', `${esc(e.message)} Pick another site in the top bar, or check <code>tools/healthray/.env</code>.`, true);
                $('fr-actionbar').hidden = true;
                return;
            }
            $('fr-site-label').textContent = info.label;
            renderFilters();
            if (pendingSearch) {
                pendingSearch = false;
                search();
            } else if (result) {
                renderResults();
            }
        })();
        try { await loading; } finally { loading = null; }
    }

    function renderFilters() {
        const prefs = store.get(prefsKey(), {});
        const scopes = Array.isArray(prefs.scopes) ? prefs.scopes : Object.keys(info.scopes);
        $('fr-scopes').innerHTML = Object.entries(info.scopes).map(([k, label]) =>
            `<label class="col-check"><input type="checkbox" name="fr-scope" value="${esc(k)}" ${scopes.includes(k) ? 'checked' : ''}> ${esc(label)}</label>`).join('');
        const statuses = Array.isArray(prefs.statuses) ? prefs.statuses : ALL_STATUSES;
        $('fr-statuses').innerHTML = info.statuses.map(s =>
            `<label class="col-check"><input type="checkbox" name="fr-status" value="${esc(s)}" ${statuses.includes(s) ? 'checked' : ''}> ${esc(s[0].toUpperCase() + s.slice(1))}</label>`).join('');
        const types = Array.isArray(prefs.types) ? prefs.types : [];
        $('fr-types').innerHTML = info.types.map(t =>
            `<label class="col-check"><input type="checkbox" name="fr-type" value="${esc(t.type)}" ${types.includes(t.type) ? 'checked' : ''}> ${esc(t.type)} <span class="tab-count">${fmtNum(t.n)}</span></label>`).join('');
        $('fr-opt-case').checked = !!prefs.case;
        $('fr-opt-word').checked = !!prefs.word;
        $('fr-opt-tags').checked = !!prefs.skipTags;
        updateFilterCount();
    }

    const checked = name => [...$('replaceView').querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

    function options() {
        return {
            find: $('fr-find').value,
            replace: $('fr-replace').value,
            case: $('fr-opt-case').checked,
            word: $('fr-opt-word').checked,
            skipTags: $('fr-opt-tags').checked,
            scopes: checked('fr-scope'),
            statuses: checked('fr-status'),
            types: checked('fr-type'),
            ids: $('fr-ids').value.trim(),
        };
    }

    function savePrefs() {
        if (!info) return;
        const o = options();
        store.set(prefsKey(), { scopes: o.scopes, statuses: o.statuses, types: o.types, case: o.case, word: o.word, skipTags: o.skipTags });
        updateFilterCount();
        updateActionbar();
    }

    function updateFilterCount() {
        const o = options();
        const n = (o.types.length ? 1 : 0) + (o.statuses.length !== ALL_STATUSES.length ? 1 : 0) + (o.ids ? 1 : 0);
        $('fr-filter-count').textContent = n || '';
    }

    function toggleFilters(force) {
        const panel = $('fr-filters');
        const open = force ?? !panel.classList.contains('open');
        panel.classList.toggle('open', open);
        $('fr-filters-btn').classList.toggle('is-open', open);
        $('fr-filters-btn').setAttribute('aria-expanded', String(open));
    }

    /* ───── Search ───── */
    function emptyHtml(title, body = '', error = false) {
        return `<div class="card-panel fr-empty${error ? ' is-error' : ''}"><h2>${title}</h2>${body ? `<p>${body}</p>` : ''}</div>`;
    }

    async function search() {
        const o = options();
        if (!info) { toast('This site\'s database is not reachable — pick another site.', 'err'); return; }
        if (o.find.trim().length < 2) {
            $('fr-find').focus();
            toast('Type at least 2 characters to find.', 'err');
            return;
        }
        if (!o.scopes.length) { toast('Pick at least one place to search in.', 'err'); return; }
        if (!o.statuses.length) { toggleFilters(true); toast('Pick at least one status in Filters.', 'err'); return; }
        savePrefs();
        const btn = $('fr-search-btn');
        btn.classList.add('fr-busy');
        btn.disabled = true;
        $('fr-results').innerHTML = '<div class="fr-skeleton"></div><div class="fr-skeleton"></div><div class="fr-skeleton"></div>';
        $('fr-actionbar').hidden = true;
        try {
            const res = await post('replace_search.php', o, nextSearchSignal());
            result = res;
            searched = o;
            done = new Set();
            lastOp = null;
            selected = new Set(res.fields.filter(f => !f.blocked).map(key));
            viewScope = '';
            viewText = '';
            shown = PAGE;
            renderResults();
        } catch (err) {
            if (isAbort(err)) return;
            result = null;
            searched = null;
            $('fr-results').innerHTML = emptyHtml('Search failed', esc(err.message), true);
        } finally {
            btn.classList.remove('fr-busy');
            btn.disabled = false;
        }
    }

    function fieldLabel(f) {
        if (f.kind === 'post') return { post_title: 'Title', post_content: 'Content', post_excerpt: 'Excerpt' }[f.field] || f.field;
        if (f.field === '_elementor_data') return 'Elementor';
        if (SEO_NAMES[f.field]) return SEO_NAMES[f.field];
        if (f.scope === 'seo') return 'SEO · ' + f.field.replace('_yoast_wpseo_', '');
        return 'Custom field';
    }

    function snippetHtml(s) {
        const rep = s.replacement === '' ? '<ins class="fr-empty-ins"></ins>' : `<ins>${esc(s.replacement)}</ins>`;
        return `<div class="fr-snip">${esc(s.before)}<del>${esc(s.match)}</del>${rep}${esc(s.after)}</div>`;
    }

    function visibleFields() {
        const t = viewText.toLowerCase();
        return result.fields.filter(f => (!viewScope || f.scope === viewScope)
            && (!t || (result.posts[f.post_id]?.title || '').toLowerCase().includes(t) || String(f.post_id) === t || f.field.toLowerCase().includes(t)));
    }

    function renderResults() {
        if (!result) return;
        const r = result;
        if (!r.fields.length) {
            $('fr-results').innerHTML = emptyHtml(`No matches for “${esc(searched.find)}”`,
                `on ${esc(siteLabel())}. Try turning off <b>Match case</b> / <b>Whole word</b>, searching in more places, or widening the Filters.`);
            $('fr-actionbar').hidden = true;
            return;
        }
        const byScope = {};
        r.fields.forEach(f => { byScope[f.scope] = (byScope[f.scope] || 0) + 1; });
        const postCount = Object.keys(r.posts).length;

        const fields = visibleFields();
        const groups = new Map();
        fields.forEach(f => { if (!groups.has(f.post_id)) groups.set(f.post_id, []); groups.get(f.post_id).push(f); });
        const ids = [...groups.keys()];

        const elementorSkipped = !searched.scopes.includes('elementor');
        let html = `<div class="card-panel fr-summary-panel">
            <div class="fr-summary">
                <div class="stats-row fr-stats">
                    <span><b>${fmtNum(r.matches)}</b> ${r.matches === 1 ? 'match' : 'matches'}</span>
                    <span><b>${fmtNum(r.fields.length)}</b> ${r.fields.length === 1 ? 'field' : 'fields'}</span>
                    <span><b>${fmtNum(postCount)}</b> ${postCount === 1 ? 'post' : 'posts'}</span>
                    <span>${(r.ms / 1000).toFixed(1)}s · ${esc(siteLabel())}</span>
                </div>
                <div class="search-wrap fr-rfilter-wrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                    <input id="fr-rfilter" type="search" placeholder="Filter by title, ID or field…" value="${esc(viewText)}" aria-label="Filter results" autocomplete="off">
                </div>
            </div>
            <div class="toolbar fr-scope-filter" role="radiogroup" aria-label="Show fields from">
                <label class="col-check"><input type="radio" name="fr-vscope" value="" ${!viewScope ? 'checked' : ''}> All <span class="tab-count">${fmtNum(r.fields.length)}</span></label>
                ${Object.entries(byScope).map(([k, n]) => `<label class="col-check"><input type="radio" name="fr-vscope" value="${esc(k)}" ${viewScope === k ? 'checked' : ''}> ${esc(info?.scopes?.[k] || k)} <span class="tab-count">${fmtNum(n)}</span></label>`).join('')}
            </div>
        </div>`;
        if (r.truncated) {
            html += `<div class="fr-notice warn"><span class="fr-notice-icon">!</span><span>Showing the first <b>${fmtNum(r.limit)}</b> fields — there are more matches. Replace these, then search again for the rest, or narrow the search with Filters.</span></div>`;
        }
        if (elementorSkipped && (ELEMENTOR_SITES.test(SITE) || isLiveSite())) {
            html += `<div class="fr-notice warn"><span class="fr-notice-icon">i</span><span><b>Elementor data</b> isn't included. Pages built with Elementor show their Elementor copy, so changing only Content won't change what visitors see.</span></div>`;
        }
        html += '<div id="fr-last-op"></div>';
        html += ids.slice(0, shown).map(id => postHtml(id, groups.get(id))).join('');
        if (!ids.length) html += emptyHtml('No results match this filter.');
        if (ids.length > shown) html += `<button class="btn fr-loadmore" id="fr-load-more" type="button">Show ${fmtNum(Math.min(PAGE, ids.length - shown))} more of ${fmtNum(ids.length - shown)} posts</button>`;
        $('fr-results').innerHTML = html;
        renderLastOp();
        $('fr-actionbar').hidden = false;
        updateActionbar();
    }

    function postHtml(id, fields) {
        const p = result.posts[id] || { id, title: '(deleted)', type: '?', status: '?' };
        const home = result.home || info?.home;
        const usable = fields.filter(f => !f.blocked && !done.has(key(f)));
        const all = usable.length && usable.every(f => selected.has(key(f)));
        const some = usable.some(f => selected.has(key(f)));
        const hasElementor = fields.some(f => f.field === '_elementor_data');
        return `<article class="fr-post ${some ? 'sel' : ''}" data-post="${id}">
            <div class="fr-post-head">
                <input type="checkbox" data-post-check="${id}" ${all ? 'checked' : ''} ${usable.length ? '' : 'disabled'} aria-label="Select all fields of this post">
                <h3 title="${esc(decodeEntities(p.title))}">${esc(decodeEntities(p.title)) || '<span class="col-note">(no title)</span>'}<small>#${id}</small></h3>
                <span class="badge badge-neutral">${esc(p.type)}</span>
                ${statusBadge(p.status)}
                <span class="fr-post-links">
                    ${home ? `<a href="${esc(home)}/?p=${id}" target="_blank" rel="noopener" title="Open on the site">View ↗</a>
                    <a href="${esc(home)}/wp-admin/post.php?post=${id}&amp;action=${hasElementor ? 'elementor' : 'edit'}" target="_blank" rel="noopener" title="Edit in WordPress">Edit ↗</a>` : ''}
                </span>
            </div>
            ${fields.map(fieldHtml).join('')}
        </article>`;
    }

    function fieldHtml(f) {
        const k = key(f);
        const isDone = done.has(k);
        const fmtBadge = f.format === 'json' ? '<span class="badge badge-neutral">JSON</span>' : f.format === 'serialized' ? '<span class="badge badge-neutral">Serialized</span>' : '';
        const more = f.count > f.snippets.length ? `<span class="fr-more">+ ${plural(f.count - f.snippets.length, 'more match', 'more matches')} in this field</span>` : '';
        return `<div class="fr-fld ${isDone ? 'done' : ''} ${f.blocked ? 'blocked' : ''}">
            <input type="checkbox" data-field="${esc(k)}" ${selected.has(k) && !isDone ? 'checked' : ''} ${f.blocked || isDone ? 'disabled' : ''} aria-label="Select ${esc(fieldLabel(f))}">
            <div class="fr-fld-name">${esc(fieldLabel(f))}
                ${f.kind === 'meta' && f.field !== '_elementor_data' ? `<code>${esc(f.field)}</code>` : ''}
                <span class="fr-fld-meta"><span class="badge fr-count">${plural(f.count, 'match', 'matches')}</span>${fmtBadge}${isDone ? '<span class="badge badge-publish">Replaced ✓</span>' : ''}</span>
            </div>
            <div class="fr-snips">${f.snippets.map(snippetHtml).join('')}${more}${f.blocked ? `<span class="fr-reason">⚠ ${esc(f.blocked)}</span>` : ''}</div>
        </div>`;
    }

    /* ───── Selection ───── */
    const selectable = () => visibleFields().filter(f => !f.blocked && !done.has(key(f)));
    const selectedFields = () => result ? result.fields.filter(f => selected.has(key(f)) && !done.has(key(f)) && !f.blocked) : [];

    /** The find/replace text or match options changed since the shown results were found. */
    function stale() {
        if (!searched) return false;
        const o = options();
        return ['find', 'replace', 'case', 'word', 'skipTags'].some(k => o[k] !== searched[k]);
    }

    function updateActionbar() {
        if (!result) return;
        const sel = selectedFields();
        const matches = sel.reduce((n, f) => n + f.count, 0);
        const posts = new Set(sel.map(f => f.post_id)).size;
        const pool = selectable();
        const all = $('fr-sel-all');
        all.checked = pool.length > 0 && pool.every(f => selected.has(key(f)));
        all.indeterminate = !all.checked && pool.some(f => selected.has(key(f)));
        all.disabled = !pool.length;
        const isStale = stale();
        $('fr-sel-text').textContent = isStale
            ? 'Find/Replace changed — search again to preview'
            : sel.length ? `${plural(sel.length, 'field')} · ${plural(posts, 'post')} · ${plural(matches, 'match', 'matches')}` : 'Nothing selected';
        $('fr-actionbar').classList.toggle('is-stale', isStale);
        const btn = $('fr-replace-btn');
        btn.disabled = busy || !sel.length || isStale;
        if (!busy) btn.textContent = sel.length && !isStale ? `Replace ${plural(matches, 'match', 'matches')}` : 'Replace selected';
    }

    function refreshPostState(id) {
        const art = $('fr-results').querySelector(`article[data-post="${id}"]`);
        if (!art) return;
        const fields = result.fields.filter(f => f.post_id === id && !f.blocked && !done.has(key(f)));
        const box = art.querySelector('[data-post-check]');
        const n = fields.filter(f => selected.has(key(f))).length;
        box.checked = fields.length > 0 && n === fields.length;
        box.indeterminate = n > 0 && n < fields.length;
        art.classList.toggle('sel', n > 0);
    }

    function setAllVisible(on) {
        selectable().forEach(f => { on ? selected.add(key(f)) : selected.delete(key(f)); });
        renderResults();
    }

    /* ───── Replace ───── */
    async function confirmReplace() {
        const sel = selectedFields();
        if (busy || !sel.length || stale()) return;
        const matches = sel.reduce((n, f) => n + f.count, 0);
        const posts = new Set(sel.map(f => f.post_id)).size;
        const label = siteLabel();
        const live = isLiveSite();
        const ok = await confirmDialog({
            title: `Replace on ${label}?`,
            message: (live ? `⚠ ${label} is the LIVE website — visitors see the change right away. ` : '')
                + `${plural(matches, 'match', 'matches')} in ${plural(sel.length, 'field')} across ${plural(posts, 'post')} on ${label}. `
                + 'A backup is saved first, and you can undo this from History.',
            changes: [{ post: `Find → Replace with${searched.case ? ' · match case' : ''}${searched.word ? ' · whole word' : ''}${searched.skipTags ? ' · skip HTML tags' : ''}`, from: searched.find, to: searched.replace, toLabel: '(removed — replaced with nothing)' }],
            okLabel: `Replace ${plural(matches, 'match', 'matches')}`,
            tone: 'danger',
        });
        if (ok) doReplace();
    }

    async function doReplace() {
        const sel = selectedFields();
        if (!sel.length || stale()) return;
        busy = true;
        const btn = $('fr-replace-btn');
        btn.disabled = true;
        btn.textContent = 'Replacing…';
        try {
            const res = await post('replace_apply.php', { ...searched, targets: sel.map(f => ({ kind: f.kind, id: f.id, field: f.field })) });
            res.changed.forEach(c => done.add(`${c.kind}:${c.id}`));
            lastOp = res;
            toast(res.msg, 'ok');
            if (res.skipped?.length) toast(`${plural(res.skipped.length, 'field')} skipped: ${res.skipped[0].reason}`, 'warn', 6000);
            busy = false;
            renderResults();
            changedPosts();
        } catch (e) {
            busy = false;
            const skipped = e.data?.skipped;
            toast(e.message + (skipped?.length ? ` (${plural(skipped.length, 'field')} skipped: ${skipped[0].reason})` : ''), 'err');
            updateActionbar();
        }
    }

    /** Other tabs show post content / meta - let them reload. */
    function changedPosts() {
        if (typeof onLinksChanged === 'function') onLinksChanged();
    }

    function renderLastOp() {
        const el = $('fr-last-op');
        if (!el) return;
        if (!lastOp) { el.innerHTML = ''; return; }
        const hints = [];
        if (isLiveSite() || ELEMENTOR_SITES.test(SITE)) hints.push('If the site uses a page cache, purge it to see the change.');
        el.innerHTML = `<div class="fr-notice ok"><span class="fr-notice-icon">✓</span><span><b>${esc(lastOp.msg)}</b> ${plural(lastOp.posts, 'post')} updated. ${hints.join(' ')}</span>
            <button class="btn small" type="button" data-fr-undo="${esc(lastOp.op)}">Undo</button></div>`;
    }

    async function undo(id, btn) {
        if (busy) return;
        const op = (lastOp?.op === id ? { find: searched?.find, replace: searched?.replace, matches: lastOp.matches, fields: lastOp.fields, posts: lastOp.posts } : null);
        const ok = await confirmDialog({
            title: `Undo this replace on ${siteLabel()}?`,
            message: 'Puts back what each field held before this replace. Fields edited again since then are left alone.',
            changes: op ? [{ post: `${plural(op.matches || 0, 'match', 'matches')} · ${plural(op.fields || 0, 'field')} · ${plural(op.posts || 0, 'post')}`, from: op.replace ?? '', to: op.find ?? '' }] : [],
            okLabel: 'Undo replace',
            tone: 'warn',
        });
        if (!ok) return;
        busy = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Undoing…'; }
        try {
            const res = await post('replace_undo.php', { id });
            toast(res.msg, res.skipped?.length ? 'warn' : 'ok');
            if (lastOp?.op === id) {
                lastOp.changed.forEach(c => done.delete(`${c.kind}:${c.id}`));
                lastOp = null;
                busy = false;
                renderResults();
            }
            changedPosts();
        } catch (e) {
            toast(e.message, 'err');
            if (btn) { btn.disabled = false; btn.textContent = 'Undo'; }
        } finally {
            busy = false;
            updateActionbar();
        }
    }

    /* History: the shared History drawer (js/history.js), filtered to Find & Replace - it lists every
     * op from this tab's journal and undoes it through fr_undo_op(), same as the inline Undo here. */
    const openReplaceHistory = () => window.openHistory({ source: 'replace' });

    /* ───── Keyboard (called by app.js for every keydown on this tab) ───── */
    function frHandleKey(e) {
        if (e.key === 'Escape') {
            const t = e.target;
            if (t && t.id === 'fr-rfilter' && t.value) { t.value = ''; viewText = ''; shown = PAGE; renderResults(); $('fr-rfilter').focus(); return true; }
            if ($('fr-filters').classList.contains('open') && !/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '')) { toggleFilters(false); return true; }
            return false;
        }
        if (isConfirmOpen()) return false;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;
        switch (e.key.toLowerCase()) {
            case 'u': openReplaceHistory(); return true;                // History, filtered to Find & Replace
            case 'e': toggleFilters(); return true;                     // filters panel
            case 'a': if (result) { setAllVisible(!$('fr-sel-all').checked); return true; } return false;
            case 'r': if (result && !$('fr-replace-btn').disabled) { confirmReplace(); return true; } return false;
            default: return false;
        }
    }

    function frHasUnsaved() {
        return !!result && selectedFields().length > 0;
    }

    /** "find=...&replace=..." (the part after "#replace?") -> prefill and search. */
    function frReadHash(query) {
        const qp = new URLSearchParams(query || '');
        const find = qp.get('find');
        if (!find) return;
        $('fr-find').value = find;
        $('fr-replace').value = qp.get('replace') || '';
        if (info) search();
        else pendingSearch = true;
    }

    /* ───── Events (delegated, scoped to #replaceView) ───── */
    function bindReplaceTab() {
        const root = $('replaceView');
        const filterResults = debounce(value => {
            viewText = value.trim();
            shown = PAGE;
            renderResults();
            const f = $('fr-rfilter');
            if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
        }, 200);

        root.addEventListener('submit', e => {
            if (e.target.id !== 'fr-form') return;
            e.preventDefault();
            search();
        });

        root.addEventListener('change', e => {
            const t = e.target;
            if (t.closest('#fr-form')) {
                if (t.type === 'checkbox') savePrefs();
                return;
            }
            if (!result) return;
            if (t.dataset.field) {
                t.checked ? selected.add(t.dataset.field) : selected.delete(t.dataset.field);
                const f = result.fields.find(x => key(x) === t.dataset.field);
                if (f) refreshPostState(f.post_id);
            } else if (t.dataset.postCheck) {
                const id = Number(t.dataset.postCheck);
                result.fields.filter(f => f.post_id === id && !f.blocked && !done.has(key(f))).forEach(f => {
                    t.checked ? selected.add(key(f)) : selected.delete(key(f));
                });
                $('fr-results').querySelectorAll(`article[data-post="${id}"] [data-field]:not(:disabled)`).forEach(i => { i.checked = t.checked; });
                refreshPostState(id);
            } else if (t.name === 'fr-vscope') {
                viewScope = t.value;
                shown = PAGE;
                renderResults();
                return;
            } else if (t.id === 'fr-sel-all') {
                setAllVisible(t.checked);
                return;
            }
            updateActionbar();
        });

        root.addEventListener('input', e => {
            const id = e.target.id;
            if (id === 'fr-find' || id === 'fr-replace' || id === 'fr-ids') {
                updateActionbar();
                updateFilterCount();
            } else if (id === 'fr-rfilter') {
                filterResults(e.target.value);
            }
        });

        root.addEventListener('click', e => {
            const t = e.target;
            if (t.closest('#fr-swap')) {
                [$('fr-find').value, $('fr-replace').value] = [$('fr-replace').value, $('fr-find').value];
                updateActionbar();
                $('fr-find').focus();
            } else if (t.closest('#fr-filters-btn')) {
                toggleFilters();
            } else if (t.closest('#fr-types-all')) {
                root.querySelectorAll('input[name="fr-type"]').forEach(i => { i.checked = false; });
                savePrefs();
            } else if (t.closest('#fr-load-more')) {
                shown += PAGE;
                renderResults();
            } else if (t.closest('#fr-replace-btn')) {
                confirmReplace();
            } else if (t.closest('#fr-history-btn')) {
                openReplaceHistory();
            } else {
                const u = t.closest('[data-fr-undo]');
                if (u) undo(u.dataset.frUndo, u);
            }
        });
    }

    Object.assign(window, { bindReplaceTab, loadReplace, frHandleKey, frHasUnsaved, frReadHash });
})();
