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
 * A folder under tools/ that isn't listed here still shows up on the
 * dashboard under "Unlisted". An entry whose path no longer exists on disk
 * is hidden, so deleting a tool's folder is enough to take it off the page.
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
            ['name' => 'Find & Replace', 'path' => 'tools/healthray/replace/', 'tags' => ['db', 'writes', 'multi'],
                'desc' => 'Search titles, content, Elementor and SEO fields, preview every change, replace what you pick. Undo history.', 'featured' => true],
            ['name' => 'Healthray File Browser', 'path' => 'tools/healthray/', 'tags' => ['multi'],
                'desc' => 'Browse the PHP/HTML files of the Healthray and Botphonic tool folders.'],
            ['name' => 'Botphonic API', 'path' => 'tools/botphonic/', 'tags' => ['db', 'writes', 'api'],
                'desc' => 'Endpoints for the Botphonic database (posts, post types, Yoast meta). No page of its own.'],
        ],
    ],
    'utilities' => [
        'label' => 'Utilities',
        'items' => [
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
    'assets' => [
        'label' => 'Assets',
        'items' => [
            ['name' => 'Brand logos', 'path' => 'assets/brand/', 'tags' => ['api'], 'desc' => 'Bigscal and Healthray logos + favicon (SVG).', 'brand' => true],
        ],
    ],
];
