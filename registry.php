<?php
/*
 * Every tool the home dashboard (index.php) shows - add a new tool here.
 *
 *   path   folder (or file) relative to this directory; the card links to it
 *   tags   any of: db (reads/writes a WordPress database), writes (can change
 *          live data), login (has its own login), lan (only reachable from this
 *          PC + office LAN - see .htaccess), api (no page; used by other tools),
 *          node (needs `node server.js` running), multi (switches between sites)
 *
 * A folder under tools/, playground/ or templates/ that isn't listed here still
 * shows up on the dashboard under "Unlisted", so nothing goes missing.
 */

return [
    'healthray' => [
        'label' => 'Healthray & Botphonic — WordPress tools',
        'items' => [
            ['name' => 'Master Dashboard', 'path' => 'tools/healthray/master-dashboard/', 'tags' => ['db', 'writes', 'multi'],
                'desc' => 'Content, Links & UTM, Link Fixer, Redirects and Bulk URL Update for every site, in one place. Undo history for link changes.', 'featured' => true],
            ['name' => 'Lead Report', 'path' => 'tools/healthray/lead/', 'tags' => ['db'],
                'desc' => 'Form submission report.'],
            ['name' => 'Menu Order', 'path' => 'tools/healthray/menu-order/', 'tags' => ['db', 'writes', 'multi'],
                'desc' => 'Reorder pages and posts (menu_order).'],
            ['name' => 'Keyword Duplicate Finder', 'path' => 'tools/healthray/focus-keyword/', 'tags' => ['db', 'writes', 'login', 'multi'],
                'desc' => 'Find posts competing for the same Yoast focus keyword.'],
            ['name' => 'WP Options Panel', 'path' => 'tools/healthray/wp_options/', 'tags' => ['db', 'writes', 'login', 'multi'],
                'desc' => 'Browse and edit wp_options rows.'],
            ['name' => 'StateCity Browser', 'path' => 'tools/healthray/stateCity/', 'tags' => ['db', 'writes'],
                'desc' => 'State/city landing pages: templates, keyphrases, bulk updates.'],
            ['name' => 'Template Explorer', 'path' => 'tools/healthray/template/', 'tags' => ['db'],
                'desc' => 'Find the right page structure / template per page.'],
            ['name' => 'Post Revisions', 'path' => 'tools/healthray/version/', 'tags' => ['db', 'writes'],
                'desc' => 'List and clean up wp_posts revisions (keeps the latest 5 per post).'],
            ['name' => 'Redirect Options Viewer', 'path' => 'tools/healthray/sql/', 'tags' => ['db'],
                'desc' => 'Raw view of the Yoast redirect options.'],
            ['name' => 'Phrase Count Report', 'path' => 'tools/healthray/phrase-count-report/', 'tags' => ['db'],
                'desc' => 'How often a phrase appears across content.'],
            ['name' => 'Find & Replace Results', 'path' => 'tools/healthray/replace/', 'tags' => ['db'],
                'desc' => 'Locate text across posts before replacing it.'],
            ['name' => 'Healthray File Browser', 'path' => 'tools/healthray/', 'tags' => ['multi'],
                'desc' => 'Browse the PHP/HTML files of the Healthray and Botphonic tool folders.'],
            ['name' => 'Botphonic API', 'path' => 'tools/botphonic/', 'tags' => ['db', 'writes', 'api'],
                'desc' => 'Endpoints for the Botphonic database (posts, post types, Yoast meta). No page of its own.'],
        ],
    ],
    'utilities' => [
        'label' => 'Utilities',
        'items' => [
            ['name' => 'Redirect Manager', 'path' => 'tools/redirection/', 'tags' => [],
                'desc' => 'Build and manage redirect rules.'],
            ['name' => 'Image Downloader', 'path' => 'tools/image-downloader/', 'tags' => ['lan'],
                'desc' => 'Pull every image from a site into a local folder.'],
            ['name' => 'Bigscal Directory Viewer', 'path' => 'tools/bigscal/', 'tags' => [],
                'desc' => 'Browse the Bigscal section folders.'],
            ['name' => 'Box Generator', 'path' => 'tools/bigscal/box/', 'tags' => ['node'],
                'desc' => 'Blog content builder (Google APIs). Run `node server.js` in tools/bigscal/box first.'],
            ['name' => 'Browser Snippets', 'path' => 'tools/browser-snippets/', 'tags' => [],
                'desc' => 'DevTools snippets: alt-text fixer, schema generator, link editor, auto-logins…'],
            ['name' => 'Timestamp Converter', 'path' => 'tools/timestamp/', 'tags' => [],
                'desc' => 'Unix timestamps ⇄ dates.'],
            ['name' => 'Phone Number Validation', 'path' => 'tools/phone-validator/', 'tags' => [],
                'desc' => 'Validate phone numbers.'],
        ],
    ],
    'playground' => [
        'label' => 'Playground — demos & experiments',
        'items' => [
            ['name' => 'Code Editor', 'path' => 'playground/code-editor/', 'tags' => ['lan'],
                'desc' => 'HTML / CSS / JS / PHP scratchpad. Runs PHP on this machine - office network only.'],
            ['name' => 'Multiplayer Bingo', 'path' => 'playground/bingo/', 'tags' => [], 'desc' => '5×5 bingo game.'],
            ['name' => 'Canvas Draw', 'path' => 'playground/canvas/draw.html', 'tags' => [], 'desc' => 'Canvas colour drawing.'],
            ['name' => 'Canvas: Dots', 'path' => 'playground/canvas/dot-canvas/', 'tags' => [], 'desc' => 'Dot animation.'],
            ['name' => 'Canvas: Motion', 'path' => 'playground/canvas/motion/', 'tags' => [], 'desc' => 'Botphonic AI canvas animation.'],
            ['name' => 'Canvas: Bot', 'path' => 'playground/canvas/botCanvas/', 'tags' => [], 'desc' => 'Bot canvas experiment.'],
            ['name' => '5×5 Array Match', 'path' => 'playground/check-line/', 'tags' => [], 'desc' => 'Line-match puzzle.'],
            ['name' => 'Sidebar Demo', 'path' => 'playground/sidebar-demo/', 'tags' => [], 'desc' => 'Sidebar layout + calculator popup.'],
            ['name' => 'Responsive Tabs', 'path' => 'playground/responsive-tabs/', 'tags' => [], 'desc' => 'Tabs that collapse into an accordion.'],
        ],
    ],
    'templates' => [
        'label' => 'Templates & assets',
        'items' => [
            ['name' => 'Bringer', 'path' => 'templates/bringer/', 'tags' => [], 'desc' => 'Digital agency HTML template (home variants, portfolio, pricing…).'],
            ['name' => 'Arrigo images', 'path' => 'templates/arrigo/', 'tags' => ['api'], 'desc' => 'Image assets for the Arrigo template (folder of images, no page).'],
            ['name' => 'Brand logos', 'path' => 'assets/brand/', 'tags' => ['api'], 'desc' => 'Bigscal and Healthray logos + favicon (SVG).', 'brand' => true],
        ],
    ],
];
