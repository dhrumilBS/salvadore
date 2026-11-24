/* ══════════════════════════ Page guides ══════════════════════════
 * Every tab opens with the same header: what the page is for (one sentence anyone understands), a
 * collapsible "How to use" in three steps, a "Good to know" line, and its main actions as visible buttons -
 * so an intern can start without being shown, and a senior can collapse it (remembered per tab, mdStore
 * md.guide.<view>). All copy lives in PAGE_GUIDES below; change wording there, not in index.html.
 *
 * Actions: { label, primary?, title?, click: '<element id>' }  - clicks an existing control
 *          { label, focus: '<element id>' }                    - focuses + opens a select/input
 *          { label, run: () => ... }                           - anything else
 *
 * Globals: bindGuides().
 */
(function () {
    'use strict';

    const PAGE_GUIDES = {
        content: {
            title: 'Posts & Pages',
            what: 'Edit titles, URLs, status, publish dates and SEO text (Google title, Google description, social share text) for any post or page - one or many at once.',
            steps: [
                'Pick a content type (Post, Page…) or search for what you need.',
                'Click into a cell and type. Changed cells turn amber - nothing is saved yet.',
                'Press <b>Save</b> on the row (or <b>Save all</b>). You see exactly what will change before it is written.',
            ],
            tip: 'The <b>“All posts”</b> filter finds SEO problems: missing or too-long titles, duplicate descriptions, no share image. More columns (Facebook / X text, social image) are under <b>Columns</b>.',
            actions: [
                { label: 'Find SEO problems', focus: 'fSeo', primary: true },
                { label: 'Update many from a URL list', click: 'bulkOpenBtn' },
            ],
        },
        menu: {
            title: 'Menu Order',
            what: 'Set the order posts and pages appear in (WordPress “Order” field) and quickly fix titles, URLs and dates - by dragging rows or typing numbers.',
            steps: [
                'Pick the content type to reorder.',
                'Drag rows, or type new order numbers / titles / dates.',
                'Press <b>Review &amp; save</b> at the bottom - nothing changes until you confirm.',
            ],
            tip: 'This is the page order WordPress uses, not your navigation menu.',
        },
        changes: {
            title: 'Recent changes',
            what: 'See what changed on the site, when, who did it and how - including bulk changes made by plugins, imports or scripts outside this dashboard.',
            steps: [
                'Pick a period (last 7 days by default).',
                'Check the <b>Bulk changes</b> cards. A red edge means many posts changed at once with no WordPress revision and not through this dashboard.',
                'Click a card or a row to see the posts. Ask the team, or check hosting logs for that time, if nobody knows what it was.',
            ],
            tip: '<b>Dashboard</b> = made here (details in History). <b>WP editor</b> = saved in WordPress, with the person. <b>No revision</b> = a plugin, import, script or database edit.',
        },
        fixer: {
            title: 'Link checker',
            what: 'Every link inside your posts: find the ones that are broken or redirect, then fix, replace or remove them - one at a time or in bulk.',
            steps: [
                'Choose content types and status at the top, then press <b>Re-check links</b> to test them live.',
                'Click a status card (<b>Broken</b>, <b>Redirects</b>…) to see only those links.',
                'Use the row buttons, or tick links and use the bar at the bottom: <b>Fix redirects</b>, <b>Replace</b>, <b>Unlink</b>. Everything can be undone in History.',
            ],
            tip: 'To find where one URL is linked across the whole site, paste it into <b>Find links site-wide</b>.',
            actions: [
                { label: 'Check how links open', run: () => document.getElementById('fx-rule').scrollIntoView({ behavior: 'smooth', block: 'center' }) },
                { label: 'Pages nobody links to', run: () => showView('internal') },
            ],
        },
        internal: {
            title: 'Internal links',
            what: 'Which of your pages get links from your other pages - and which get none (“orphans”). Google finds and ranks pages through these links.',
            steps: [
                'Start with <b>Orphans (indexed)</b>: pages that should rank but nobody links to.',
                'Open a related post with <b>Edit ↗</b> and add a link to the orphan in its text.',
                'Switch to <b>Links to retired URLs</b> to fix links that point at deleted or redirected pages.',
            ],
            tip: 'Counts come from post content, FAQs, Elementor and menus. Links in theme templates or footers are not in the database, so they don’t count here.',
        },
        keywords: {
            title: 'Focus keywords',
            what: 'The Yoast focus keyword of every post. Find duplicates - two pages competing for the same search - and posts with no keyword.',
            steps: [
                'Pick a content type. <b>Duplicates only</b> shows pages sharing a keyword (same colour = same keyword).',
                'Keep the keyword on the main page; give the others a more specific one.',
                'Click a keyword to edit it, then <b>Review &amp; save</b>.',
            ],
            tip: 'A noindex page (ads / PPC, thank-you) doesn’t compete in Google, but give it its own keyword anyway so reports stay clean.',
        },
        canonical: {
            title: 'Canonical URLs',
            what: 'A canonical tells Google which URL is the “real” one. This finds canonicals that point at pages that redirect, are gone or were deleted - Google may then drop the page.',
            steps: [
                'Start with <b>Live posts affected</b>.',
                'If the old URL redirects, use <b>Use target</b>; otherwise <b>Remove</b> - the page then points at itself (the normal setting).',
                'Changes can be undone in History.',
            ],
        },
        redirects: {
            title: 'Redirects',
            what: 'Send visitors from an old URL to a new one (301), or tell Google a page is gone for good (410). Every Yoast redirect, with problems flagged.',
            steps: [
                'Moved or deleted a page? Press <b>Add redirect</b>: old URL → new URL, type 301 (or 410 if there is no replacement).',
                'Use the status filter to find problems: conflicts, missing destinations, chains, noindex destinations.',
                'Edit, duplicate or delete per row, or tick rows for bulk changes. A backup is taken before every save.',
            ],
            tip: 'A <b>chain</b> (A → B → C) slows visitors and Google down - use <b>Point to final</b>.',
            actions: [{ label: 'Find problem redirects', focus: 'rMatch', primary: true }],
        },
        replace: {
            title: 'Find & Replace',
            what: 'Change a piece of text everywhere at once - an old phone number, a brand name, an old URL - in titles, content, Elementor and SEO fields.',
            steps: [
                'Type what to find and what to replace it with, choose where to look, press <b>Search</b>.',
                'Untick anything that should stay as it is.',
                'Press <b>Replace</b>. A backup is taken; undo from History.',
            ],
            tip: 'Matching is exact text (case-sensitive option available) - no wildcards, so nothing unexpected changes.',
        },
    };

    const $ = id => document.getElementById(id);

    function runAction(a) {
        if (a.run) { a.run(); return; }
        const el = $(a.click || a.focus);
        if (!el) return;
        if (a.click) { el.click(); return; }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        if (el.tagName === 'SELECT' && typeof el.showPicker === 'function') { try { el.showPicker(); } catch (e) { /* needs a user gesture in some browsers */ } }
        el.classList.remove('guide-flash');
        void el.offsetWidth;
        el.classList.add('guide-flash');
    }

    function render(view, g) {
        const open = mdStore.get(`guide.${view}`, true) !== false;
        const actions = (g.actions || []).map((a, i) =>
            `<button type="button" class="btn${a.primary ? ' primary' : ''}" data-guide-act="${i}"${a.title ? ` title="${escapeHtml(a.title)}"` : ''}>${escapeHtml(a.label)}</button>`).join('');
        return `<section class="page-guide${open ? ' is-open' : ''}" data-guide="${view}" aria-label="About this page">
            <div class="pg-main">
                <div class="pg-text">
                    <h2 class="pg-title">${escapeHtml(g.title)}</h2>
                    <p class="pg-what">${escapeHtml(g.what)}</p>
                </div>
                <div class="pg-actions">${actions}
                    <button type="button" class="btn pg-toggle" data-guide-toggle aria-expanded="${open}" title="Show or hide the steps">${open ? 'Hide steps' : 'How to use'}</button>
                </div>
            </div>
            <div class="pg-more">
                <ol class="pg-steps">${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>
                ${g.tip ? `<p class="pg-tip"><b>Good to know:</b> ${g.tip}</p>` : ''}
            </div>
        </section>`;
    }

    function bindGuides() {
        Object.entries(PAGE_GUIDES).forEach(([view, g]) => {
            const el = $(VIEWS[view]?.el);
            if (!el || el.querySelector(':scope > .page-guide')) return;
            el.insertAdjacentHTML('afterbegin', render(view, g));
            const box = el.querySelector(':scope > .page-guide');
            box.addEventListener('click', e => {
                const t = e.target.closest('[data-guide-toggle]');
                if (t) {
                    const open = !box.classList.contains('is-open');
                    box.classList.toggle('is-open', open);
                    t.textContent = open ? 'Hide steps' : 'How to use';
                    t.setAttribute('aria-expanded', String(open));
                    mdStore.set(`guide.${view}`, open);
                    return;
                }
                const a = e.target.closest('[data-guide-act]');
                if (a) runAction(g.actions[Number(a.dataset.guideAct)]);
            });
        });
    }

    window.bindGuides = bindGuides;
})();
