/* ══════════════════════════ App wiring ══════════════════════════
 * View switching + cross-tab freshness + global keyboard shortcuts. Every
 * tab loads lazily the first time it's opened. When one tab writes something
 * another tab displays (a post's status/slug, a link inside post content, a
 * new 410 redirect), that other tab is marked stale and reloads the next time
 * it's shown - or right away if it's the one on screen. The active tab lives
 * in the URL hash (#content, #fixer, #redirects, #menu, #replace,
 * #keywords, #canonical) so each one is bookmarkable; Link Fixer adds its own filters after a
 * "?" (#fixer?page=2) and Find & Replace accepts #replace?find=...&replace=... */

const VIEWS = {
    overview:  { el: 'overviewView',  load: loadOverview, search: null,         key: e => ovHandleKey(e) },
    content:   { el: 'contentView',   load: loadContent,  search: 'fSearch' },
    fixer:     { el: 'fixerView',     load: loadFixer,    search: 'fx-search' },
    redirects: { el: 'redirectsView', load: loadRedirects, search: 'rSearch',    key: e => rHandleKey(e) },
    menu:      { el: 'menuView',      load: loadMenu,     search: 'mo-search',  key: e => moHandleKey(e) },
    replace:   { el: 'replaceView',   load: loadReplace,  search: 'fr-find',    key: e => frHandleKey(e) },
    keywords:  { el: 'keywordsView',  load: loadKeywords, search: 'kw-search',  key: e => kwHandleKey(e) },
    canonical: { el: 'canonicalView', load: loadCanonicals, search: 'cn-search', key: e => cnHandleKey(e) },
};

let activeView = 'overview';
const viewNeedsLoad = { overview: true, content: true, fixer: true, redirects: true, menu: true, replace: true, keywords: true, canonical: true };

/* Retired tabs whose old bookmarks still work: Links & UTM was merged into Links (Link Fixer),
 * Bulk URL Update into Content (#bulk also opens its panel). */
const VIEW_ALIASES = { links: 'fixer', bulk: 'content' };

/** "#fixer?page=2" -> ['fixer', 'page=2'] (old names mapped through VIEW_ALIASES) */
function parseHash() {
    const [view, query = ''] = location.hash.slice(1).split('?');
    return [VIEW_ALIASES[view] || view, query];
}

/* Two-level nav: each view tab carries data-group; the group row shows the
 * section, the tab row only that section's tabs. A group click reopens the
 * tab last used in it (per browser, md.nav.last). */
const groupOfView = view => document.querySelector(`#viewTabs .view-tab[data-view="${view}"]`)?.dataset.group || 'dashboard';
let lastViewByGroup = {};
lastViewByGroup = mdStore.get('nav.last', {}) || {};

function syncNav(view) {
    const group = groupOfView(view);
    document.querySelectorAll('#navGroups .nav-group').forEach(b => {
        const on = b.dataset.group === group;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    let shown = 0;
    document.querySelectorAll('#viewTabs .view-tab').forEach(b => {
        const on = b.dataset.view === view;
        b.hidden = b.dataset.group !== group;
        if (!b.hidden) shown++;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    document.getElementById('viewTabs').classList.toggle('is-single', shown < 2);
    lastViewByGroup[group] = view;
    mdStore.set('nav.last', lastViewByGroup);
}

function showGroup(group) {
    const tabs = [...document.querySelectorAll(`#viewTabs .view-tab[data-group="${group}"]`)].map(b => b.dataset.view);
    if (tabs.length) showView(tabs.includes(lastViewByGroup[group]) ? lastViewByGroup[group] : tabs[0]);
}

function showView(view, { skipLoad = false } = {}) {
    view = VIEW_ALIASES[view] || view;
    if (!VIEWS[view]) view = 'overview';
    activeView = view;
    syncNav(view);
    Object.entries(VIEWS).forEach(([key, v]) => {
        document.getElementById(v.el).style.display = key === view ? '' : 'none';
    });
    fxUpdateBulkBar(); // each floating bulk bar belongs to its own tab
    syncRedirectSelection();
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

/** A post's status/slug/title/order changed (Content save, Bulk status apply, Menu Order save).
 * The tab that made the change keeps its own rows in sync, so it is never reloaded here. */
function onPostsChanged() {
    markStale(['overview', 'content', 'redirects', 'fixer', 'menu', 'keywords', 'canonical'].filter(v => v !== activeView));
}

/** Post content / meta changed (Link Fixer write or undo, Find & Replace apply or undo). */
function onLinksChanged() {
    markStale(['overview', 'content', 'fixer', 'menu', 'keywords', 'canonical'].filter(v => v !== activeView));
}

/** A Yoast redirect rule was added/edited/deleted (Redirects tab, trash -> 410 prompts, History undo). */
function onRedirectsChanged() {
    markStale(['redirects', 'overview', 'canonical'].filter(v => v !== activeView));
}

/** A canonical was removed/replaced (Canonicals tab, the "retired URL" prompt). The visible tab reloads too. */
function onCanonicalsChanged() {
    markStale(['canonical', 'overview']);
}

/* ══════════════════════════ Keyboard ══════════════════════════
 * Global: ? help · / search the current tab · g then c/l/f/r/b to switch tab
 * · h history. Link Fixer adds its own keys while it's on screen
 * (fxHandleKey). Nothing fires while typing in a field, except Esc. */
let gPending = 0;

function openHelp() { document.getElementById('helpModal').classList.add('open'); document.getElementById('helpOk').focus(); }
function closeHelp() { document.getElementById('helpModal').classList.remove('open'); }
const isHelpOpen = () => document.getElementById('helpModal').classList.contains('open');

/** Hand a key to the active tab's own handler (Menu Order, Find & Replace, Focus Keywords). */
function tabKey(e) {
    const handler = VIEWS[activeView].key;
    return !!(handler && handler(e));
}

function onGlobalKey(e) {
    // Ctrl/Cmd+K palette + post drawer (js/finder.js) - takes every key while open, prevents its own.
    if (finderHandleKey(e)) return;
    // Menu Order's Ctrl+S must work while typing and inside its own review dialog
    if (activeView === 'menu' && tabKey(e)) { e.preventDefault(); return; }
    if (isConfirmOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
        return;
    }
    if (e.key === 'Escape') {
        if (isHelpOpen()) { closeHelp(); return; }
        if (isHistoryOpen()) { closeHistory(); return; }
        if (activeView === 'fixer' && fxHandleKey(e)) { e.preventDefault(); return; }
        if (activeView !== 'menu' && tabKey(e)) e.preventDefault();
        return;
    }
    if (isHelpOpen() || isHistoryOpen() || document.querySelector('.modal-backdrop.open, .fx-modal-overlay.open')) return;

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey) {
        // the ported tabs do their own typing checks
        if (activeView !== 'menu' && tabKey(e)) e.preventDefault();
        return;
    }

    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === '/') {
        const input = document.getElementById(VIEWS[activeView].search);
        if (input) { e.preventDefault(); input.focus(); input.select?.(); }
        return;
    }
    const k = e.key.toLowerCase();
    if (Date.now() - gPending < 1200) {
        gPending = 0;
        if (k === 'b') { e.preventDefault(); openBulkSection(); return; }
        const target = { o: 'overview', c: 'content', l: 'fixer', f: 'fixer', r: 'redirects', m: 'menu', s: 'replace', k: 'keywords', n: 'canonical' }[k];
        if (target) { e.preventDefault(); showView(target); }
        return;
    }
    if (k === 'g') { gPending = Date.now(); return; }
    if (k === 'h') { e.preventDefault(); openHistory({ source: '' }); return; }
    if (activeView === 'fixer' && fxHandleKey(e)) { e.preventDefault(); return; }
    if (activeView !== 'menu' && tabKey(e)) e.preventDefault();
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initDensity();
    LinkStatus.bind();
    bindCopyButtons();
    bindConfirmDialog();
    bindHistory();
    bindFinder();

    bindContentTab();
    bindFixerTab();
    bindRedirectsTab();
    bindBulkTab();
    bindMenuTab();
    bindReplaceTab();
    bindKeywordsTab();
    bindCanonicalTab();
    bindOverviewTab();
    bindSavedViews();

    bindDatabaseSwitcher();
    // Pin this page to one site before anything else talks to the API.
    await initSite();
    refreshHistoryCount();

    document.getElementById('viewTabs').addEventListener('click', e => {
        const btn = e.target.closest('.view-tab');
        if (btn) showView(btn.dataset.view);
    });
    document.getElementById('navGroups').addEventListener('click', e => {
        const btn = e.target.closest('.nav-group');
        if (btn) showGroup(btn.dataset.group);
    });
    window.addEventListener('hashchange', () => {
        const [view, query] = parseHash();
        if (view === 'fixer' && query) fxReadHash(query);
        if (view === 'replace' && query) frReadHash(query);
        if (location.hash.startsWith('#bulk')) { openBulkSection(); return; }
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
    populateFixerPostTypes(opts.post_types);
    populateFixerStatuses(opts.statuses);

    const [view, query] = parseHash();
    if (view === 'fixer') fxReadHash(query);
    if (view === 'replace' && query) frReadHash(query);
    showView(view || 'overview');
    if (location.hash.startsWith('#bulk')) openBulkSection();
});
