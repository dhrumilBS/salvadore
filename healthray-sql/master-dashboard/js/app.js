/* ══════════════════════════ App wiring ══════════════════════════
 * View switching + cross-tab freshness + global keyboard shortcuts. Every
 * tab loads lazily the first time it's opened. When one tab writes something
 * another tab displays (a post's status/slug, a link inside post content, a
 * new 410 redirect), that other tab is marked stale and reloads the next time
 * it's shown - or right away if it's the one on screen. The active tab lives
 * in the URL hash (#content, #links, #fixer, #redirects, #bulk) so each one is
 * bookmarkable; Link Fixer adds its own filters after a "?" (#fixer?page=2). */

const VIEWS = {
    content:   { el: 'contentView',   load: loadContent,  search: 'fSearch' },
    links:     { el: 'linksView',     load: loadLinks,    search: 'lSearch' },
    fixer:     { el: 'fixerView',     load: loadFixer,    search: 'fx-search' },
    redirects: { el: 'redirectsView', load: loadRedirects, search: 'rSearch' },
    bulk:      { el: 'bulkView',      load: null,         search: 'bulkUrlsInput' }, // only searches on demand
};

let activeView = 'content';
const viewNeedsLoad = { content: true, links: true, fixer: true, redirects: true, bulk: false };

/** "#fixer?page=2" -> ['fixer', 'page=2'] */
function parseHash() {
    const [view, query = ''] = location.hash.slice(1).split('?');
    return [view, query];
}

function showView(view, { skipLoad = false } = {}) {
    if (!VIEWS[view]) view = 'content';
    activeView = view;
    document.querySelectorAll('#viewTabs .view-tab').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    Object.entries(VIEWS).forEach(([key, v]) => {
        document.getElementById(v.el).style.display = key === view ? '' : 'none';
    });
    fxUpdateBulkBar(); // the floating bar belongs to Link Fixer only
    if (viewNeedsLoad[view] && VIEWS[view].load) {
        viewNeedsLoad[view] = false;
        if (!skipLoad) VIEWS[view].load();
    }
    if (view === 'fixer') fxWriteHash();
    else if (parseHash()[0] !== view) history.replaceState(null, '', '#' + view);
}

function markStale(views) {
    views.forEach(v => {
        if (v === activeView && VIEWS[v].load) VIEWS[v].load();
        else viewNeedsLoad[v] = true;
    });
}

/** A post's status/slug/title/etc changed (Content save, Bulk status apply). */
function onPostsChanged() {
    markStale(['links', 'redirects', 'fixer'].concat(activeView === 'bulk' ? ['content'] : []));
}

/** Links inside post content changed (Link Fixer write / undo). Link Fixer keeps its own rows in sync. */
function onLinksChanged() {
    markStale(['links', 'content'].filter(v => v !== activeView));
}

/** A Yoast redirect rule was added/replaced (trash -> 410 prompts). */
function onRedirectsChanged() {
    markStale(['redirects']);
}

/* ══════════════════════════ Keyboard ══════════════════════════
 * Global: ? help · / search the current tab · g then c/l/f/r/b to switch tab
 * · h history. Link Fixer adds its own keys while it's on screen
 * (fxHandleKey). Nothing fires while typing in a field, except Esc. */
let gPending = 0;

function openHelp() { document.getElementById('helpModal').classList.add('open'); document.getElementById('helpOk').focus(); }
function closeHelp() { document.getElementById('helpModal').classList.remove('open'); }
const isHelpOpen = () => document.getElementById('helpModal').classList.contains('open');

function onGlobalKey(e) {
    if (isConfirmOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
        return;
    }
    if (e.key === 'Escape') {
        if (isHelpOpen()) { closeHelp(); return; }
        if (isHistoryOpen()) { closeHistory(); return; }
        if (activeView === 'fixer' && fxHandleKey(e)) { e.preventDefault(); return; }
        return;
    }
    if (isHelpOpen() || isHistoryOpen() || document.querySelector('.modal-backdrop.open, .fx-modal-overlay.open')) return;

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === '/') {
        const input = document.getElementById(VIEWS[activeView].search);
        if (input) { e.preventDefault(); input.focus(); input.select?.(); }
        return;
    }
    const k = e.key.toLowerCase();
    if (Date.now() - gPending < 1200) {
        gPending = 0;
        const target = { c: 'content', l: 'links', f: 'fixer', r: 'redirects', b: 'bulk' }[k];
        if (target) { e.preventDefault(); showView(target); }
        return;
    }
    if (k === 'g') { gPending = Date.now(); return; }
    if (k === 'h') { e.preventDefault(); openHistory(); return; }
    if (activeView === 'fixer' && fxHandleKey(e)) e.preventDefault();
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    LinkStatus.bind();
    bindCopyButtons();
    bindConfirmDialog();
    bindHistory();

    bindContentTab();
    bindLinksTab();
    bindFixerTab();
    bindRedirectsTab();
    bindBulkTab();

    bindDatabaseSwitcher();
    // Pin this page to one site before anything else talks to the API.
    await initSite();
    refreshHistoryCount();

    document.getElementById('viewTabs').addEventListener('click', e => {
        const btn = e.target.closest('.view-tab');
        if (btn) showView(btn.dataset.view);
    });
    window.addEventListener('hashchange', () => {
        const [view, query] = parseHash();
        if (view === 'fixer' && query) fxReadHash(query);
        showView(view);
    });
    document.addEventListener('keydown', onGlobalKey);
    document.getElementById('helpBtn').addEventListener('click', openHelp);
    document.getElementById('helpOk').addEventListener('click', closeHelp);
    document.getElementById('helpClose').addEventListener('click', closeHelp);
    document.getElementById('helpModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeHelp(); });

    // Status/post-type options feed the Content, Links and Link Fixer filters -
    // load them before the first list request so the dropdowns are never empty.
    const opts = await loadFilterOptions();
    populateContentPostTypes(opts.post_types);
    populateContentStatuses(opts.statuses);
    populateLinksFilters(opts.post_types, opts.statuses);
    populateFixerPostTypes(opts.post_types);
    populateFixerStatuses(opts.statuses);

    const [view, query] = parseHash();
    if (view === 'fixer') fxReadHash(query);
    showView(view || 'content');
});
