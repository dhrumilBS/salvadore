/* ══════════════════════════ Overview tab ══════════════════════════
 * "What needs fixing on this site today?" on one screen. Read-only.
 * Numbers come from api/overview.php (two parts fetched in parallel: core =
 * content/SEO/revisions/links, redirects = Yoast redirect health) plus the
 * optional api/activity_list.php. Every number opens the matching tab
 * pre-filtered:
 *
 *   Link Fixer      #fixer?status=error|redirect  #fixer?type=external|internal  #fixer?find=<url>&status=error
 *   Content         drives #fPostTypeTabs / #fStatus (after #clearFiltersBtn) - no deep-link support of its own
 *   Focus Keywords  drives #kw-post-type / #kw-status / #kw-only-dup and the "Missing keyword" stat card
 *   Redirects       drives #rClearFiltersBtn, #rMatch (origin_live | dest_missing), .redirect-type-cb[value=410]
 *   Canonicals      drives #cn-kind / #cn-scope (counts from canonical_report.php?summary=1)
 *   Revisions       ../version/?db=<site>&only_old=1 (new browser tab; landing | botphonic only)
 *
 * Broken-link status is not known server-side: "Check links" collects the
 * published posts' links (links_list.php), live-checks up to LINK_CAP unique
 * http(s) URLs through the shared LinkStatus checker (results cached and
 * shared with every other tab), then shows broken / redirecting counts.
 *
 * Exposes bindOverviewTab(), loadOverview(), ovHandleKey(e), ovHasUnsaved().
 */
(() => {
    'use strict';

    const LINK_CAP = 300;
    const STALE_ON_SHOW_MS = 5 * 60 * 1000;
    const VERSION_SITES = ['landing', 'botphonic'];
    const STATUS_LABEL = { publish: 'Published', draft: 'Drafts', pending: 'Pending review', future: 'Scheduled', private: 'Private', trash: 'Trash' };

    const $ = id => document.getElementById(id);
    const nextCoreSignal = latestOnly();
    const nextRedirSignal = latestOnly();
    const nextActivitySignal = latestOnly();
    const nextLinksSignal = latestOnly();
    const nextCanonSignal = latestOnly();

    const st = {
        core: null, redirects: null, activity: null, canon: null, // last good payloads
        coreErr: '', redirErr: '', canonErr: '',
        loading: { core: false, redirects: false },
        loadedAt: 0,
        timing: {},
        site: null,
        links: { all: null, urls: null, running: false, cancel: false, phase: '', done: 0, of: 0, err: '', checkedAt: 0, capped: false },
    };

    /* ══════════════════════════ Loading ══════════════════════════ */

    let generation = 0;

    /** Fetch one part; each part paints as soon as it lands, so the slow one never holds the other back. */
    function loadPart(part, signal, gen, apply) {
        return api('overview.php', { params: { part }, signal })
            .then(json => {
                if (!json.success) throw new Error(json.msg || 'Server error');
                if (gen === generation) apply(json);
            })
            .catch(err => {
                if (isAbort(err) || gen !== generation) return;
                console.error(err);
                if (part === 'core') st.coreErr = errText(err); else st.redirErr = errText(err);
            })
            .finally(() => {
                if (gen !== generation) return; // a newer refresh owns the loading flags
                st.loading[part] = false;
                render();
            });
    }

    function loadOverview() {
        const gen = ++generation;
        st.loading.core = st.loading.redirects = true;
        st.coreErr = st.redirErr = '';
        const t0 = performance.now();
        render();

        const core = loadPart('core', nextCoreSignal(), gen, json => {
            st.core = json;
            st.site = Object.assign({}, st.site, json.site);
            st.timing.core = json.timings && json.timings.request;
        });
        const redirects = loadPart('redirects', nextRedirSignal(), gen, json => {
            st.redirects = json.redirects;
            st.site = Object.assign({}, json.site, st.site);
            st.timing.redirects = json.timings && json.timings.request;
        });
        loadActivity();
        loadCanonicals();

        return Promise.all([core, redirects]).then(() => {
            if (gen !== generation) return;
            st.loadedAt = Date.now();
            st.timing.total = Math.round(performance.now() - t0);
            renderHead();
        });
    }

    /** Recent activity: optional endpoint - hide the card silently when it's missing or fails. */
    function loadActivity() {
        api('activity_list.php', { params: { limit: 8 }, signal: nextActivitySignal() })
            .then(json => {
                st.activity = json && json.success && Array.isArray(json.entries) ? json : null;
                renderActivity();
            })
            .catch(err => {
                if (isAbort(err)) return;
                st.activity = null;
                renderActivity();
            });
    }

    /** Canonical audit counts (own request - never holds the other cards back). */
    function loadCanonicals() {
        st.canonErr = '';
        api('canonical_report.php', { params: { summary: 1, unmatched: 0 }, signal: nextCanonSignal() })
            .then(json => {
                if (!json.success) throw new Error(json.msg || 'Server error');
                st.canon = json;
            })
            .catch(err => {
                if (isAbort(err)) return;
                console.error(err);
                st.canonErr = errText(err);
            })
            .finally(renderCanonicals);
    }

    const errText = err => (err && err.message && !/JSON|Unexpected token/i.test(err.message)) ? err.message : 'Could not load';

    /* ══════════════════════════ Small helpers ══════════════════════════ */

    /** Severity for an "issue" count: zero is calm. */
    const sevOf = (n, level = 'warn') => (n > 0 ? level : 'ok');
    const goAttr = spec => ` data-ov-go="${escapeHtml(JSON.stringify(spec))}"`;

    function timeAgo(iso) {
        const t = Date.parse(iso);
        if (!t) return '';
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + ' min ago';
        if (s < 86400) return Math.floor(s / 3600) + ' h ago';
        if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
        return new Date(t).toLocaleDateString();
    }

    /** The post type with the most of `key` in seo.by_type, and a "page 4 · post 2" breakdown. */
    function topType(key) {
        const byType = (st.core && st.core.seo && st.core.seo.by_type) || {};
        const list = Object.entries(byType).filter(([, v]) => v[key] > 0).sort((a, b) => b[1][key] - a[1][key]);
        return {
            type: list.length ? list[0][0] : '',
            breakdown: list.map(([t, v]) => `${t} ${fmtNum(v[key])}`).join(' · '),
            others: list.slice(1).map(([t, v]) => `${t} ${fmtNum(v[key])}`).join(', '),
        };
    }

    /** The content type with the most rows in `status` (falls back to the biggest published type). */
    function topStatusType(status) {
        const types = (st.core && st.core.content && st.core.content.types) || [];
        const list = types.filter(t => t[status] > 0).sort((a, b) => b[status] - a[status]);
        return {
            type: list.length ? list[0].type : (types[0] ? types[0].type : ''),
            breakdown: list.map(t => `${t.type} ${fmtNum(t[status])}`).join(' · '),
            others: list.slice(1).map(t => `${t.type} ${fmtNum(t[status])}`).join(', '),
        };
    }

    const ICONS = {
        seo: '<path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/><path d="m21 21-4.3-4.3"/>',
        redirects: '<path d="M4 7h11a4 4 0 0 1 0 8H8"/><polyline points="7 11 4 15 7 19" transform="translate(0 -4)"/>',
        links: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
        content: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><path d="M8 13h8M8 17h5"/>',
        revisions: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/>',
        activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
        canonical: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
    };
    const icon = name => `<svg class="ov-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    const chevron = '<svg class="ov-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
    const extIcon = '<svg class="ov-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><polyline points="8 7 17 7 17 16"/></svg>';

    /**
     * One clickable "label .... number >" row.
     * sev: ok (an issue count that is zero) | warn | danger | info (a plain count)
     */
    function row({ label, value, sev = 'info', go = null, href = null, title = '', sub = '' }) {
        const num = typeof value === 'number' ? fmtNum(value) : escapeHtml(value);
        const okMark = sev === 'ok' ? '<span class="ov-okmark" aria-hidden="true">✓</span>' : '';
        const inner = `<span class="ov-row-main"><span class="ov-row-label">${escapeHtml(label)}</span>` +
            (sub ? `<span class="ov-row-sub">${escapeHtml(sub)}</span>` : '') + '</span>' +
            `<span class="ov-num sev-${sev}">${okMark}${num}</span>`;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        if (href) return `<a class="ov-row" href="${escapeHtml(href)}" target="_blank" rel="noopener"${t}>${inner}${extIcon}</a>`;
        if (go) return `<button type="button" class="ov-row"${goAttr(go)}${t}>${inner}${chevron}</button>`;
        return `<div class="ov-row is-static"${t}>${inner}<span class="ov-chev-space"></span></div>`;
    }

    /** Card frame. `issues` (number|null) drives the header chip: 0 = "All good". */
    function card(key, title, body, { issues = null, level = 'warn', foot = '', note = '' } = {}) {
        let chip = '';
        if (issues === 0) chip = '<span class="ov-chip sev-ok">All good</span>';
        else if (issues > 0) chip = `<span class="ov-chip sev-${level}">${pluralize(issues, 'issue')}</span>`;
        return `<header class="ov-card-head"><h3 class="ov-card-title" id="ov-t-${key}">${icon(key)}<span>${escapeHtml(title)}</span></h3>${chip}</header>` +
            `<div class="ov-rows">${body}</div>` +
            (note ? `<p class="ov-note">${note}</p>` : '') +
            (foot ? `<footer class="ov-card-foot">${foot}</footer>` : '');
    }

    function skeletonCard(key, title, rows = 3) {
        const r = '<div class="ov-row is-skel"><span class="ov-sk ov-sk-line"></span><span class="ov-sk ov-sk-val"></span></div>';
        return `<header class="ov-card-head"><h3 class="ov-card-title" id="ov-t-${key}">${icon(key)}<span>${escapeHtml(title)}</span></h3></header>` +
            `<div class="ov-rows" aria-busy="true">${r.repeat(rows)}</div>`;
    }

    function errorCard(key, title, msg) {
        return `<header class="ov-card-head"><h3 class="ov-card-title" id="ov-t-${key}">${icon(key)}<span>${escapeHtml(title)}</span></h3></header>` +
            `<div class="ov-error"><span>${escapeHtml(msg)}</span><button type="button" class="btn small" data-ov-act="retry">Retry</button></div>`;
    }

    function setCard(id, html, { busy = false } = {}) {
        const el = $(id);
        if (!el) return;
        el.innerHTML = html;
        el.classList.toggle('is-refreshing', busy);
    }

    /* ══════════════════════════ Render ══════════════════════════ */

    function render() {
        renderHead();
        renderKpis();
        renderSeo();
        renderRedirects();
        renderLinks();
        renderContent();
        renderRevisions();
        renderCanonicals();
    }

    function renderCanonicals() {
        const c = st.canon;
        if (!c) { setCard('ov-card-canonical', st.canonErr ? errorCard('canonical', 'Canonical URLs', st.canonErr) : skeletonCard('canonical', 'Canonical URLs', 4)); return; }
        const L = c.live_counts || {}, A = c.counts || {};
        const live = (L.gone || 0) + (L.redirect || 0) + (L.not_live || 0);
        const all = (A.gone || 0) + (A.redirect || 0) + (A.not_live || 0);
        const rows = [
            row({ label: 'Live posts affected', value: live, sev: sevOf(live, 'danger'), sub: live ? 'Canonical points at a dead / moved URL' : 'Every live canonical resolves', go: { tab: 'canonical', scope: 'live' } }),
            row({ label: '→ 410 Gone', value: A.gone || 0, sev: L.gone ? 'danger' : 'info', sub: `${fmtNum(L.gone || 0)} live`, go: { tab: 'canonical', kind: 'gone' } }),
            row({ label: '→ Redirect', value: A.redirect || 0, sev: L.redirect ? 'warn' : 'info', sub: `${fmtNum(L.redirect || 0)} live`, go: { tab: 'canonical', kind: 'redirect' } }),
            row({ label: '→ Trashed / unpublished post', value: A.not_live || 0, sev: L.not_live ? 'warn' : 'info', sub: `${fmtNum(L.not_live || 0)} live`, go: { tab: 'canonical', kind: 'not_live' } }),
        ];
        setCard('ov-card-canonical', card('canonical', 'Canonical URLs', rows.join(''), {
            issues: live, level: 'danger',
            note: all > live ? `${fmtNum(all - live)} more on drafts / pending posts (not public yet). ${fmtNum(c.scanned)} posts set a canonical.` : `${fmtNum(c.scanned)} posts set a canonical.`,
        }));
    }

    function renderHead() {
        const s = st.site || {};
        const fromList = (typeof siteList !== 'undefined' && siteList.find(d => d.key === SITE)) || null;
        const label = s.label || (fromList && fromList.label) || SITE || 'Overview';
        $('ov-site-name').textContent = s.name ? `${s.name}` : label;
        $('ov-site-name').title = label;
        $('ov-live').hidden = !(s.live || (typeof isLiveSite === 'function' && isLiveSite()));
        const home = $('ov-home');
        if (s.home) {
            home.hidden = false;
            home.href = s.home;
            home.textContent = s.home.replace(/^https?:\/\//, '') + ' ↗';
        } else {
            home.hidden = true;
        }

        const busy = st.loading.core || st.loading.redirects;
        const btn = $('ov-refresh');
        btn.disabled = busy;
        btn.classList.toggle('is-running', busy);
        const upd = $('ov-updated');
        if (busy && !st.loadedAt) upd.textContent = 'Counting…';
        else if (busy) upd.textContent = 'Refreshing…';
        else if (st.loadedAt) {
            const secs = st.timing.total ? ` · ${(st.timing.total / 1000).toFixed(1)} s` : '';
            upd.textContent = `Updated ${new Date(st.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${secs}`;
            upd.title = `Server: core ${st.timing.core ?? '–'} ms, redirects ${st.timing.redirects ?? '–'} ms` +
                (st.redirects && st.redirects.cached ? ' (redirect checks reused - nothing they depend on changed)' : '');
        } else upd.textContent = '';
    }

    function kpi({ label, value, sub = '', sev = 'info', go = null, act = '', title = '' }) {
        const num = typeof value === 'number' ? fmtNum(value) : escapeHtml(value);
        const attrs = go ? goAttr(go) : (act ? ` data-ov-act="${act}"` : '');
        return `<button type="button" class="ov-kpi sev-${sev}"${attrs}${title ? ` title="${escapeHtml(title)}"` : ''}>` +
            `<span class="ov-kpi-label"><i class="ov-dot" aria-hidden="true"></i>${escapeHtml(label)}</span>` +
            `<span class="ov-kpi-num">${num}</span>` +
            `<span class="ov-kpi-sub">${escapeHtml(sub)}</span></button>`;
    }

    const kpiSkel = '<div class="ov-kpi ov-skel"><span class="ov-sk ov-sk-label"></span><span class="ov-sk ov-sk-num"></span><span class="ov-sk ov-sk-sub"></span></div>';

    function renderKpis() {
        const c = st.core, r = st.redirects;
        const out = [];
        if (c) {
            const t = c.content.totals, seo = c.seo;
            const gaps = seo.missing_title + seo.missing_desc + seo.missing_kw;
            out.push(kpi({
                label: 'Published', value: t.publish, sev: 'info',
                sub: `${fmtNum(t.draft)} drafts · ${fmtNum(t.future)} scheduled`,
                go: { tab: 'content', type: topStatusType('publish').type, status: 'publish' },
                title: 'Published posts across every real content type',
            }));
            out.push(kpi({
                label: 'SEO gaps', value: gaps, sev: sevOf(gaps),
                sub: gaps ? `${fmtNum(seo.missing_title)} title · ${fmtNum(seo.missing_desc)} desc · ${fmtNum(seo.missing_kw)} kw` : 'Titles, descriptions, keywords set',
                go: { tab: 'scroll', card: 'ov-card-seo' },
                title: 'Published posts missing a Yoast meta title, meta description or focus keyword (each gap counted)',
            }));
            const dk = topType('dup_kw_posts');
            out.push(kpi({
                label: 'Duplicate keywords', value: seo.dup_kw_posts, sev: sevOf(seo.dup_kw_posts),
                sub: seo.dup_kw_posts ? `${pluralize(seo.dup_kw_terms, 'shared term')}` : 'Every focus keyword unique',
                go: seo.dup_kw_posts ? { tab: 'keywords', type: dk.type, mode: 'dup', others: dk.others } : { tab: 'keywords', type: topStatusType('publish').type, mode: '' },
                title: 'Published posts whose focus keyword is used by another post of the same type',
            }));
        } else if (st.coreErr) {
            out.push(kpi({ label: 'Overview', value: '!', sev: 'danger', sub: 'Could not load - retry', act: 'retry' }));
            out.push(kpiSkel.replace('ov-skel', 'ov-skel is-dead'), kpiSkel.replace('ov-skel', 'ov-skel is-dead'));
        } else out.push(kpiSkel, kpiSkel, kpiSkel);

        if (r) {
            const bad = r.conflicts + r.dest_missing;
            out.push(kpi({
                label: 'Redirect issues', value: bad, sev: r.conflicts ? 'danger' : sevOf(bad),
                sub: bad ? `${fmtNum(r.conflicts)} conflicts · ${fmtNum(r.dest_missing)} no destination` : `${pluralize(r.total, 'rule')}, all healthy`,
                go: { tab: 'redirects', match: r.conflicts ? 'origin_live' : (r.dest_missing ? 'dest_missing' : '') },
                title: 'Yoast redirects whose origin is still a live post, or whose destination is not a live post',
            }));
        } else if (st.redirErr) out.push(kpi({ label: 'Redirects', value: '!', sev: 'danger', sub: 'Could not load - retry', act: 'retry' }));
        else out.push(kpiSkel);

        if (c) {
            out.push(kpi({
                label: 'Links', value: c.links.total, sev: 'info',
                sub: `${fmtNum(c.links.external)} external · ${fmtNum(c.links.internal)} internal`,
                go: { tab: 'fixer' },
                title: 'Links (<a href>) in the content of published posts',
            }));
        } else if (!st.coreErr) out.push(kpiSkel);

        out.push(brokenKpi());
        $('ov-kpis').innerHTML = out.join('');
    }

    function brokenKpi() {
        const L = st.links;
        if (L.running) {
            const sub = L.phase === 'collect' ? 'Collecting links…' : `Checking ${fmtNum(L.done)}/${fmtNum(L.of)}…`;
            return kpi({ label: 'Broken links', value: '…', sev: 'info', sub, act: 'check-links', title: 'Click to cancel' });
        }
        if (!L.urls) return kpi({ label: 'Broken links', value: '?', sev: 'info', sub: 'Not checked - click to check', act: 'check-links', title: `Live-check up to ${LINK_CAP} unique link URLs (c)` });
        const s = linkSummary();
        return kpi({
            label: 'Broken links', value: s.broken, sev: s.broken ? 'danger' : (s.checked ? 'ok' : 'info'),
            sub: s.checked ? `${fmtNum(s.redirect)} redirecting · ${fmtNum(s.checked)} checked` : 'Not checked yet',
            go: { tab: 'fixer', status: 'error' },
            title: 'Broken links, timeouts and server errors among the checked URLs - opens the Links tab filtered to broken',
        });
    }

    function renderSeo() {
        const c = st.core;
        if (!c) { setCard('ov-card-seo', st.coreErr ? errorCard('seo', 'SEO gaps', st.coreErr) : skeletonCard('seo', 'SEO gaps', 5)); return; }
        const s = c.seo;
        const mt = topType('missing_title'), md = topType('missing_desc'), mk = topType('missing_kw'), dk = topType('dup_kw_posts');
        // %T = the post type opened (filled in by goContent)
        const rows = [
            row({
                label: 'Missing meta title', value: s.missing_title, sev: sevOf(s.missing_title),
                sub: s.missing_title ? mt.breakdown : 'Every post has a custom title',
                go: { tab: 'content', type: 'any', status: 'publish', seo: 'missing_title' },
                title: 'No custom Yoast SEO title - the post falls back to the title template',
            }),
            row({
                label: 'Missing meta description', value: s.missing_desc, sev: sevOf(s.missing_desc),
                sub: s.missing_desc ? md.breakdown : 'Every post has a description',
                go: { tab: 'content', type: 'any', status: 'publish', seo: 'missing_desc' },
                title: 'No Yoast meta description',
            }),
            row({
                label: 'Missing focus keyword', value: s.missing_kw, sev: sevOf(s.missing_kw),
                sub: s.missing_kw ? mk.breakdown : 'Every post has a keyword',
                go: { tab: 'keywords', type: mk.type || topStatusType('publish').type, mode: 'without', others: mk.others },
                title: 'No Yoast focus keyphrase',
            }),
            row({
                label: 'Duplicate focus keywords', value: s.dup_kw_posts, sev: sevOf(s.dup_kw_posts),
                sub: s.dup_kw_posts ? `${pluralize(s.dup_kw_terms, 'term')} · ${dk.breakdown}` : 'No two posts share a keyword',
                go: { tab: 'keywords', type: dk.type || topStatusType('publish').type, mode: 'dup', others: dk.others },
                title: 'Posts whose focus keyword (case-insensitive) is also used by another published post of the same type',
            }),
            row({
                label: 'Duplicate meta titles', value: s.dup_title_posts, sev: sevOf(s.dup_title_posts),
                sub: s.dup_title_posts ? `${pluralize(s.dup_title_groups, 'shared title')}` : 'No literal title repeats',
                go: { tab: 'content', type: 'any', status: 'publish', seo: 'dup_title' },
                title: 'Published posts with the exact same custom meta title (titles built from %%variables%% are ignored)',
            }),
        ];
        const issues = s.missing_title + s.missing_desc + s.missing_kw + s.dup_kw_posts + s.dup_title_posts;
        setCard('ov-card-seo', card('seo', 'SEO gaps', rows.join(''), {
            issues,
            note: `${pluralize(s.published, 'published post')} across ${pluralize(Object.keys(s.by_type).length, 'content type')}.`,
        }), { busy: st.loading.core });
    }

    function renderRedirects() {
        const r = st.redirects;
        if (!r) { setCard('ov-card-redirects', st.redirErr ? errorCard('redirects', 'Redirects', st.redirErr) : skeletonCard('redirects', 'Redirects', 4)); return; }
        const rows = [
            row({
                label: 'Origin still live', value: r.conflicts, sev: sevOf(r.conflicts, 'danger'),
                sub: r.conflicts ? 'Redirect hides a published post' : 'No conflicts',
                go: { tab: 'redirects', match: 'origin_live' },
                title: 'The redirect origin is still a published/private/scheduled post (conflict)',
            }),
            row({
                label: 'Destination missing', value: r.dest_missing, sev: sevOf(r.dest_missing),
                sub: r.dest_missing ? 'Target is not a live post' : 'Every target resolves',
                go: { tab: 'redirects', match: 'dest_missing' },
                title: 'Plain redirects whose destination path does not match a live post',
            }),
            row({
                label: '410 Gone', value: r.gone_410, sev: 'info',
                sub: 'Retired URLs',
                go: { tab: 'redirects', type: '410' },
            }),
            row({
                label: 'Total rules', value: r.total, sev: 'info',
                sub: `${fmtNum(r.plain)} plain · ${fmtNum(r.regex)} regex`,
                go: { tab: 'redirects' },
            }),
        ];
        setCard('ov-card-redirects', card('redirects', 'Redirects', rows.join(''), {
            issues: r.conflicts + r.dest_missing, level: r.conflicts ? 'danger' : 'warn',
            note: r.regex ? 'Regex rules are listed but never matched against posts.' : '',
        }), { busy: st.loading.redirects });
    }

    /** Broken / redirect / ok counts over the URLs the last check collected. */
    function linkSummary() {
        const L = st.links;
        const s = { checked: 0, ok: 0, redirect: 0, broken: 0, blocked: 0, pending: 0, brokenList: [], redirectList: [] };
        (L.urls || []).forEach(u => {
            const b = LinkStatus.bucket(u);
            if (b === 'unchecked' || b === 'checking') { s.pending++; return; }
            s.checked++;
            if (b === 'ok') s.ok++;
            else if (b === 'redirect') { s.redirect++; s.redirectList.push(u); }
            else if (b === 'blocked') s.blocked++;
            else { s.broken++; s.brokenList.push(u); } // broken (4xx/5xx) + error/timeout, like Link Fixer's "Broken"
        });
        return s;
    }

    function renderLinks() {
        const c = st.core;
        if (!c) { setCard('ov-card-links', st.coreErr ? errorCard('links', 'Links', st.coreErr) : skeletonCard('links', 'Links', 4)); return; }
        const L = st.links;
        const rows = [
            row({ label: 'Links in published content', value: c.links.total, sev: 'info', sub: `in ${pluralize(c.links.posts, 'post')}`, go: { tab: 'fixer' } }),
            row({ label: 'External', value: c.links.external, sev: 'info', sub: 'Other domains', go: { tab: 'fixer', type: 'external' } }),
            row({ label: 'Internal', value: c.links.internal, sev: 'info', sub: 'This site', go: { tab: 'fixer', type: 'internal' } }),
        ];

        let check = '';
        let issues = null;
        if (L.running) {
            const pct = L.of ? Math.round(L.done / L.of * 100) : 0;
            const label = L.phase === 'collect' ? 'Collecting links from published posts…' : `Checking ${fmtNum(L.done)} of ${fmtNum(L.of)} URLs…`;
            check = `<div class="ov-check"><div class="ov-check-top"><span>${label}</span>` +
                `<button type="button" class="btn small" data-ov-act="check-links">${L.cancel ? 'Stopping…' : 'Cancel'}</button></div>` +
                `<div class="ov-progress"><i style="width:${L.phase === 'collect' ? 8 : pct}%"></i></div></div>`;
        } else if (!L.urls) {
            check = `<div class="ov-check"><p class="ov-check-hint">Broken-link status isn't stored anywhere - check live. ` +
                `Up to ${LINK_CAP} unique URLs, most-linked first; results are shared with the Links tab.</p>` +
                (L.err ? `<p class="ov-check-err">${escapeHtml(L.err)}</p>` : '') +
                `<button type="button" class="btn primary" data-ov-act="check-links">Check links</button></div>`;
        } else {
            const s = linkSummary();
            issues = s.broken + s.redirect;
            const scope = L.all.length > L.urls.length ? `${fmtNum(L.urls.length)} of ${fmtNum(L.all.length)} unique URLs` : `${pluralize(L.urls.length, 'unique URL')}`;
            rows.push(
                row({ label: 'Broken', value: s.broken, sev: sevOf(s.broken, 'danger'), sub: s.broken ? '4xx / 5xx / timeout' : 'Nothing broken', go: { tab: 'fixer', status: 'error' } }),
                row({ label: 'Redirecting', value: s.redirect, sev: sevOf(s.redirect), sub: s.redirect ? 'Could point at the final URL' : 'No redirect hops', go: { tab: 'fixer', status: 'redirect' } }),
            );
            const worst = s.brokenList.slice(0, 5).map(u => {
                const meta = L.byUrl.get(u);
                const res = LinkStatus.get(u);
                const code = res && res.status_code ? res.status_code : 'err';
                return `<li><button type="button" class="ov-url"${goAttr({ tab: 'fixer', find: u, status: 'error' })} title="Open the posts linking here in the Links tab">` +
                    `<span class="ov-url-code">${escapeHtml(String(code))}</span><span class="ov-url-text">${escapeHtml(u)}</span>` +
                    `<span class="ov-url-n">${meta ? pluralize(meta.posts.size, 'post') : ''}</span></button></li>`;
            }).join('');
            check = (worst ? `<ul class="ov-urls" aria-label="Broken URLs">${worst}</ul>` : '') +
                `<div class="ov-check ov-check-done"><span class="ov-check-hint">${scope} · ${fmtNum(s.checked)} checked` +
                (s.pending ? ` · ${fmtNum(s.pending)} pending` : '') + (s.blocked ? ` · ${fmtNum(s.blocked)} not checkable` : '') +
                (L.checkedAt ? ` · ${timeAgo(new Date(L.checkedAt).toISOString())}` : '') + '</span>' +
                `<button type="button" class="btn small" data-ov-act="check-links" title="Collect links again and check any URL without a fresh result">Check again</button></div>`;
        }
        setCard('ov-card-links', card('links', 'Links', rows.join('') + check, { issues, level: 'danger' }), { busy: st.loading.core });
    }

    function renderContent() {
        const c = st.core;
        if (!c) { setCard('ov-card-content', st.coreErr ? errorCard('content', 'Content', st.coreErr) : skeletonCard('content', 'Content', 4)); return; }
        const t = c.content.totals;
        const types = c.content.types.filter(x => x.publish > 0);
        const chips = types.map(x =>
            `<button type="button" class="ov-type"${goAttr({ tab: 'content', type: x.type, status: 'publish' })} title="Published ${escapeHtml(x.type)}">` +
            `<span>${escapeHtml(x.type)}</span><b>${fmtNum(x.publish)}</b></button>`).join('');
        const statusRow = (status, extra = {}) => {
            const top = topStatusType(status);
            return row(Object.assign({
                label: STATUS_LABEL[status], value: t[status], sev: 'info',
                sub: t[status] ? top.breakdown : 'None',
                go: { tab: 'content', type: top.type, status, others: top.others },
            }, extra));
        };
        const rows = [
            `<div class="ov-types" role="group" aria-label="Published by type">${chips || '<span class="ov-row-sub">Nothing published yet</span>'}</div>`,
            statusRow('draft'),
            t.pending ? statusRow('pending', { sev: 'warn', title: 'Waiting for review' }) : '',
            statusRow('future'),
            statusRow('trash'),
        ];
        setCard('ov-card-content', card('content', 'Content', rows.join(''), {
            note: `${fmtNum(t.publish)} published${t.private ? ` · ${fmtNum(t.private)} private` : ''}.`,
        }), { busy: st.loading.core });
    }

    function renderRevisions() {
        const c = st.core;
        if (!c) { setCard('ov-card-revisions', st.coreErr ? errorCard('revisions', 'Revisions', st.coreErr) : skeletonCard('revisions', 'Revisions', 3)); return; }
        const r = c.revisions;
        const href = VERSION_SITES.includes(SITE) ? `../version/?db=${encodeURIComponent(SITE)}&only_old=1` : null;
        const rows = [
            row({
                label: `Posts with more than ${r.keep} revisions`, value: r.posts_over, sev: sevOf(r.posts_over),
                sub: r.posts_over ? 'Older revisions can be cleaned up' : 'Nothing to clean up', href,
            }),
            row({
                label: 'Deletable revisions', value: r.deletable, sev: sevOf(r.deletable),
                sub: `Keeps the latest ${r.keep} per post`, href,
            }),
            row({ label: 'Total revisions', value: r.revisions, sev: 'info', sub: `across ${pluralize(r.posts, 'post')}`, href }),
        ];
        setCard('ov-card-revisions', card('revisions', 'Revisions', rows.join(''), {
            issues: r.posts_over ? r.posts_over : 0,
            note: href ? 'Opens the Post Revisions tool in a new tab.' : 'The Post Revisions tool supports Healthray and Botphonic only.',
        }), { busy: st.loading.core });
    }

    function renderActivity() {
        const el = $('ov-card-activity');
        if (!el) return;
        const a = st.activity;
        if (!a) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        const items = a.entries.slice(0, 8).map(e => {
            const undone = e.undone || e.undone_at || e.undone_by;
            return `<li class="ov-act${undone ? ' is-undone' : ''}">` +
                `<span class="ov-act-src">${escapeHtml(e.source || '')}</span>` +
                `<span class="ov-act-sum" title="${escapeHtml(e.summary || '')}">${escapeHtml(e.summary || e.action || '')}</span>` +
                (undone ? '<span class="ov-chip sev-info">undone</span>' : '') +
                `<time class="ov-act-time" datetime="${escapeHtml(e.time || '')}" title="${escapeHtml(e.time ? new Date(e.time).toLocaleString() : '')}">${escapeHtml(timeAgo(e.time))}</time></li>`;
        }).join('');
        const viewAll = typeof openHistory === 'function' ? '<button type="button" class="btn small" data-ov-act="history">View all</button>' : '';
        const recent = typeof a.recent_24h === 'number' ? `${pluralize(a.recent_24h, 'change')} in the last 24 h` : '';
        el.innerHTML = `<header class="ov-card-head"><h3 class="ov-card-title" id="ov-t-activity">${icon('activity')}<span>Recent activity</span></h3>` +
            (recent ? `<span class="ov-chip sev-info">${escapeHtml(recent)}</span>` : '') + '</header>' +
            (items ? `<ul class="ov-acts">${items}</ul>` : '<p class="ov-calm">No changes made through the dashboard yet.</p>') +
            (viewAll ? `<footer class="ov-card-foot">${viewAll}</footer>` : '');
    }

    /* ══════════════════════════ Check links ══════════════════════════ */

    async function checkLinks() {
        const L = st.links;
        if (L.running) { L.cancel = true; renderLinks(); return; }
        if (!st.core) { toast('Wait for the overview to load first', 'warn'); return; }
        Object.assign(L, { running: true, cancel: false, phase: 'collect', done: 0, of: 0, err: '' });
        renderLinks(); renderKpis();
        try {
            const json = await api('links_list.php', { params: { post_type: 'any', status: 'publish' }, signal: nextLinksSignal() });
            if (!json.success) throw new Error(json.msg || 'Could not collect links');
            const byUrl = new Map();
            (json.data || []).forEach(p => (p.links || []).forEach(l => {
                if (!/^https?:\/\//i.test(l.url || '')) return;
                let m = byUrl.get(l.url);
                if (!m) { m = { url: l.url, n: 0, posts: new Set() }; byUrl.set(l.url, m); }
                m.n++;
                m.posts.add(p.id);
            }));
            L.byUrl = byUrl;
            L.all = [...byUrl.values()].sort((a, b) => b.posts.size - a.posts.size || b.n - a.n);
            L.urls = L.all.slice(0, LINK_CAP).map(x => x.url);
            L.capped = !!json.capped;
            if (L.cancel) return;
            L.phase = 'check';
            await LinkStatus.checkMany(L.urls, {
                skipChecked: true, // reuse every result LinkStatus already has (this tab or any other)
                isCancelled: () => L.cancel,
                onProgress: (done, total) => { L.done = done; L.of = total; renderLinks(); renderKpis(); },
            });
            L.checkedAt = Date.now();
            if (!L.cancel) {
                const s = linkSummary();
                toast(s.broken ? `${pluralize(s.broken, 'broken link')} found` : 'No broken links among the checked URLs', s.broken ? 'warn' : 'ok');
            }
        } catch (err) {
            if (isAbort(err)) return;
            console.error(err);
            L.err = errText(err);
            if (!L.urls) toast('Link check failed - ' + L.err, 'err');
        } finally {
            L.running = false;
            L.phase = '';
            renderLinks(); renderKpis();
        }
    }

    /* ══════════════════════════ Deep links into other tabs ══════════════════════════
     * Link Fixer + Find & Replace read filters from the hash. The others have
     * no deep-link API, so their filter controls are driven the way a person
     * would (set value + fire change/input/click) - the same approach as
     * js/views.js saved views. pushState keeps Back -> Overview working. */

    function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

    /** Set a <select> if it has that option; fires change. Returns true if it changed. */
    function setSelect(id, value) {
        const el = $(id);
        if (!el || ![...el.options].some(o => o.value === value) || el.value === value) return false;
        el.value = value;
        fire(el, 'change');
        return true;
    }

    function waitFor(test, timeout = 10000) {
        return new Promise(resolve => {
            const t0 = Date.now();
            (function poll() {
                let ok = false;
                try { ok = test(); } catch (e) { ok = false; }
                if (ok) resolve(true);
                else if (Date.now() - t0 > timeout) resolve(false);
                else setTimeout(poll, 60);
            })();
        });
    }

    /** Switch tab with a history entry. skipLoad: our own control changes will trigger the tab's load. */
    function enter(view, { skipLoad = false } = {}) {
        if (location.hash !== '#' + view) history.pushState(null, '', '#' + view);
        showView(view, { skipLoad });
    }

    function goContent(spec) {
        if (typeof hasUnsavedContentEdits === 'function' && hasUnsavedContentEdits()) {
            enter('content');
            toast('Content has unsaved edits - its filters were left as they are', 'warn', 5000);
            return;
        }
        const needed = viewNeedsLoad.content;
        enter('content', { skipLoad: true });
        let loading = false;
        const clear = $('clearFiltersBtn');
        if (clear) { clear.click(); loading = true; }
        const tab = spec.type && [...document.querySelectorAll('#fPostTypeTabs .tab')].find(t => t.dataset.type === spec.type);
        if (tab) { tab.click(); loading = true; }
        if (spec.status && setSelect('fStatus', spec.status)) loading = true;
        if (spec.seo && setSelect('fSeo', spec.seo)) loading = true;
        if (!loading && needed) loadContent();
        if (spec.note) toast(spec.note.replace('%T', spec.type || 'posts'), '', 6500);
        else if (spec.others) toast(`Showing ${spec.type}. Also: ${spec.others}`, '', 5000);
    }

    function goRedirects(spec) {
        const needed = viewNeedsLoad.redirects;
        enter('redirects', { skipLoad: true });
        const clear = $('rClearFiltersBtn');
        if (clear) clear.click();
        else if (needed) loadRedirects();
        if (spec.match) setSelect('rMatch', spec.match);
        if (spec.type) {
            const cb = document.querySelector(`#redirectsView .redirect-type-cb[value="${CSS.escape(spec.type)}"]`);
            if (cb && !cb.checked) { cb.checked = true; fire(cb, 'change'); }
        }
    }

    async function goKeywords(spec) {
        enter('keywords');
        const sel = $('kw-post-type');
        const ready = await waitFor(() => sel.options.length && !/loading/i.test(sel.options[0].text));
        if (activeView !== 'keywords') return; // the user moved on while it loaded
        if (!ready) { toast('Focus Keywords is still loading - pick the filters there', 'warn'); return; }
        if (spec.type && [...sel.options].some(o => o.value === spec.type)) {
            sel.value = spec.type;
            fire(sel, 'change'); // also clears category / keyword / presence filters
        }
        setSelect('kw-status', 'publish');
        const dup = $('kw-only-dup');
        const wantDup = spec.mode === 'dup';
        if (dup && dup.checked !== wantDup) { dup.checked = wantDup; fire(dup, 'change'); }
        const search = $('kw-search');
        if (search && search.value) { search.value = ''; fire(search, 'input'); }
        if (spec.mode === 'without') {
            const stat = document.querySelector('#keywordsView .kw-stat[data-kw-stat="without"]');
            if (stat) stat.click();
        }
        if (spec.others) toast(`Showing ${spec.type}. Also: ${spec.others}`, '', 5000);
    }

    function goFixer(spec) {
        const p = new URLSearchParams();
        if (spec.status) p.set('status', spec.status);
        if (spec.type) p.set('type', spec.type);
        if (spec.find) p.set('find', spec.find);
        const target = '#fixer' + (p.toString() ? '?' + p : '');
        // fxReadHash() only sets state; an already-loaded Link Fixer must re-fetch for a new site-wide find.
        if (spec.find && !viewNeedsLoad.fixer) {
            window.addEventListener('hashchange', () => { if (parseHash()[0] === 'fixer') loadFixer(); }, { once: true });
        }
        location.hash = target; // app.js: hashchange -> fxReadHash() + showView('fixer')
        const find = $('fx-find');
        if (!spec.find && find && find.value) {
            toast(`The Links tab is still searching for "${find.value}" - clear its find box to see every post`, 'warn', 6000);
        }
    }

    function goCanonical(spec) {
        enter('canonical');
        setSelect('cn-kind', spec.kind || '') || fire($('cn-kind'), 'change');
        setSelect('cn-scope', spec.scope || '');
    }

    function go(spec) {
        switch (spec.tab) {
            case 'canonical': goCanonical(spec); break;
            case 'content': goContent(spec); break;
            case 'redirects': goRedirects(spec); break;
            case 'keywords': goKeywords(spec); break;
            case 'fixer': goFixer(spec); break;
            case 'scroll': {
                const el = $(spec.card);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.remove('is-flash');
                    void el.offsetWidth; // restart the animation
                    el.classList.add('is-flash');
                }
                break;
            }
        }
    }

    /* ══════════════════════════ Binding ══════════════════════════ */

    function bindOverviewTab() {
        const view = $('overviewView');
        if (!view) return;

        view.addEventListener('click', e => {
            const goEl = e.target.closest('[data-ov-go]');
            if (goEl) {
                let spec = null;
                try { spec = JSON.parse(goEl.dataset.ovGo); } catch (err) { /* malformed */ }
                if (spec) go(spec);
                return;
            }
            const act = e.target.closest('[data-ov-act]');
            if (!act) return;
            const what = act.dataset.ovAct;
            if (what === 'check-links') checkLinks();
            else if (what === 'retry') loadOverview();
            else if (what === 'history' && typeof openHistory === 'function') openHistory();
        });
        $('ov-refresh').addEventListener('click', () => loadOverview());

        // A recheck anywhere (Link Fixer, Links tab...) updates the shared cache - keep our counts current.
        LinkStatus.onChange(() => {
            if (st.links.urls && !st.links.running && view.style.display !== 'none') { renderLinks(); renderKpis(); }
        });

        // Coming back to a long-idle overview: recount (app.js has no "overview is stale" hook yet).
        new MutationObserver(() => {
            const visible = view.style.display !== 'none';
            if (visible && st.loadedAt && !st.loading.core && !st.loading.redirects && Date.now() - st.loadedAt > STALE_ON_SHOW_MS) loadOverview();
        }).observe(view, { attributes: true, attributeFilter: ['style'] });
    }

    /** Keys while Overview is on screen: r refresh, c check links. Never claims / ? g h. */
    function ovHandleKey(e) {
        if (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return false;
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return false;
        const k = (e.key || '').toLowerCase();
        if (k === 'r') { loadOverview(); return true; }
        if (k === 'c') { checkLinks(); return true; }
        return false;
    }

    function ovHasUnsaved() {
        return false;
    }

    window.bindOverviewTab = bindOverviewTab;
    window.loadOverview = loadOverview;
    window.ovHandleKey = ovHandleKey;
    window.ovHasUnsaved = ovHasUnsaved;
})();
