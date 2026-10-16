<?php
/*
 * Every tool the home dashboard (index.php) shows - add a new tool here.
 *
 *   path   folder (or file) relative to this directory; the card links to it
 *   tags   any of: db (reads/writes a WordPress database), writes (can change
 *          live data), login (has its own login), lan (only reachable from this
 *          PC + office LAN - see .htaccess), api (no page; used by other tools),
 *          node (needs `node server.js` running), multi (switches between sites)
 *   icon   assets/icons/<icon>.svg (the tool's favicon too), or a path to an SVG
 *   desc   one line - shown as the card's tooltip and matched by the search
 *
 * A folder under tools/ that isn't listed here still shows up on the
 * dashboard under "Unlisted". An entry whose path no longer exists on disk
 * is hidden, so deleting a tool's folder is enough to take it off the page.
 */

return [
    'healthray' => [
        'label' => 'Healthray & Botphonic — WordPress tools',
        'items' => [
            ['name' => 'Master Dashboard', 'path' => 'tools/healthray/master-dashboard/', 'icon' => 'master-dashboard', 'tags' => ['db', 'writes', 'multi'],
                'desc' => 'Every WordPress task in one place: Content, Links & UTM, Link Fixer, Redirects, Bulk URL Update, Menu Order, Find & Replace and Focus Keywords. Undo history for link changes and replaces.', 'featured' => true],
            ['name' => 'Lead Report', 'path' => 'tools/healthray/lead/', 'icon' => 'lead-report', 'tags' => ['db'],
                'desc' => 'Form submission report.'],
            ['name' => 'WP Options Panel', 'path' => 'tools/healthray/wp_options/', 'icon' => 'wp-options', 'tags' => ['db', 'writes', 'login', 'multi'],
                'desc' => 'Browse and edit wp_options rows.'],
            ['name' => 'Template Pages', 'path' => 'tools/healthray/template-pages/', 'icon' => 'template-pages', 'tags' => ['db', 'writes'],
                'desc' => 'Pages per page template (HIMS, EMR, EHR, PMS, Lab…) with their city pages: live URL status, canonical, menu order, staged title/slug/status edits. Replaces StateCity Browser and Template Explorer.'],
            ['name' => 'Post Revisions', 'path' => 'tools/healthray/version/', 'icon' => 'post-revisions', 'tags' => ['db', 'writes'],
                'desc' => 'List and clean up wp_posts revisions (keeps the latest 5 per post).'],
            ['name' => 'Healthray File Browser', 'path' => 'tools/healthray/', 'icon' => 'file-browser', 'tags' => ['multi'],
                'desc' => 'Browse the PHP/HTML files of the Healthray and Botphonic tool folders.'],
            ['name' => 'Botphonic API', 'path' => 'tools/botphonic/', 'icon' => 'botphonic-api', 'tags' => ['db', 'writes', 'api'],
                'desc' => 'Endpoints for the Botphonic database (posts, post types, Yoast meta). No page of its own.'],
        ],
    ],
    'utilities' => [
        'label' => 'Utilities',
        'items' => [
            ['name' => 'Image Downloader', 'path' => 'tools/image-downloader/', 'icon' => 'image-downloader', 'tags' => ['lan'],
                'desc' => 'Pull every image from a site into a local folder.'],
            ['name' => 'Blog Content Builder', 'path' => 'tools/bigscal/', 'icon' => 'blog-builder', 'tags' => [],
                'desc' => 'Bigscal blog content builder: blog post, content boxes and CTAs in WordPress paste format, loads Google Docs directly (office network).'],
            ['name' => 'Browser Snippets', 'path' => 'tools/browser-snippets/', 'icon' => 'browser-snippets', 'tags' => [],
                'desc' => 'DevTools snippets: alt-text fixer, schema generator, link editor, auto-logins…'],
            ['name' => 'Timestamp Converter', 'path' => 'tools/timestamp/', 'icon' => 'timestamp', 'tags' => [],
                'desc' => 'Unix timestamps ⇄ dates.'],
            ['name' => 'Phone Number Validation', 'path' => 'tools/phone-validator/', 'icon' => 'phone-validator', 'tags' => [],
                'desc' => 'Validate phone numbers.'],
        ],
    ],
    'assets' => [
        'label' => 'Assets',
        'items' => [
            ['name' => 'Brand & Icons', 'path' => 'assets/', 'icon' => 'assets/brand/favicon.svg', 'tags' => [],
                'desc' => 'Company logos and every tool icon: preview, copy URL, download.', 'brand' => true],
        ],
    ],
];
