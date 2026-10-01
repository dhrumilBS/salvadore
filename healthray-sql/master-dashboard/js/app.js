/* ══════════════════════════ App wiring ══════════════════════════
 * View switching + cross-tab freshness. Every tab loads lazily the first
 * time it's opened. When one tab writes something another tab displays
 * (a post's status/slug, a new 410 redirect), that other tab is marked
 * stale and reloads the next time it's shown - or right away if it's the
 * one on screen. The active tab lives in the URL hash (#content, #links,
 * #redirects, #bulk) so each one is bookmarkable. */

const VIEWS = {
    content:   { el: 'contentView',   load: loadContent },
    links:     { el: 'linksView',     load: loadLinks },
    redirects: { el: 'redirectsView', load: loadRedirects },
    bulk:      { el: 'bulkView',      load: null }, // only searches on demand
};

let activeView = 'content';
const viewNeedsLoad = { content: true, links: true, redirects: true, bulk: false };

function showView(view) {
    if (!VIEWS[view]) view = 'content';
    activeView = view;
    document.querySelectorAll('#viewTabs .view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    Object.entries(VIEWS).forEach(([key, v]) => {
        document.getElementById(v.el).style.display = key === view ? '' : 'none';
    });
    if (viewNeedsLoad[view] && VIEWS[view].load) {
        viewNeedsLoad[view] = false;
        VIEWS[view].load();
    }
    if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
}

function markStale(views) {
    views.forEach(v => {
        if (v === activeView && VIEWS[v].load) VIEWS[v].load();
        else viewNeedsLoad[v] = true;
    });
}

/** A post's status/slug/title/etc changed (Content save, Bulk status apply). */
function onPostsChanged() {
    markStale(['links', 'redirects'].concat(activeView === 'bulk' ? ['content'] : []));
}

/** A Yoast redirect rule was added/replaced (trash -> 410 prompts). */
function onRedirectsChanged() {
    markStale(['redirects']);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    LinkStatus.bind();
    bindCopyButtons();

    bindContentTab();
    bindLinksTab();
    bindRedirectsTab();
    bindBulkTab();

    bindDatabaseSwitcher();
    loadDatabaseSwitcher();

    document.getElementById('viewTabs').addEventListener('click', e => {
        const btn = e.target.closest('.view-tab');
        if (btn) showView(btn.dataset.view);
    });
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

    // Status/post-type options feed both the Content and Links filters - load
    // them before the first list request so the dropdowns are never empty.
    const opts = await loadFilterOptions();
    populateContentStatuses(opts.statuses);
    populateLinksFilters(opts.post_types, opts.statuses);

    showView(location.hash.slice(1) || 'content');
});
