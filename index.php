<?php
/*
 * Salvadore home: a launcher for every tool in this folder.
 * Tools are listed in registry.php; any folder under tools/ that isn't
 * listed is still shown (under "Unlisted"), and a listed tool whose folder
 * has been deleted is left out. Styles: assets/home.css, behaviour: assets/home.js.
 * Read-only: this page never creates, edits or deletes anything.
 */
$groups = require __DIR__ . '/registry.php';

// Drop entries whose folder/file is gone, then any group left empty.
$listed = [];
foreach ($groups as $key => $g) {
    $groups[$key]['items'] = array_values(array_filter($g['items'], fn($it) => file_exists(__DIR__ . '/' . strtok($it['path'], '#'))));
    if (!$groups[$key]['items']) {
        unset($groups[$key]);
        continue;
    }
    foreach ($groups[$key]['items'] as $it) {
        $listed[rtrim(strtok($it['path'], '#'), '/')] = true;
    }
}

// Folders on disk the registry doesn't mention yet.
$unlisted = [];
foreach (glob(__DIR__ . '/tools/*', GLOB_ONLYDIR) ?: [] as $dir) {
    $rel = 'tools/' . basename($dir);
    $known = isset($listed[$rel]) || array_filter(array_keys($listed), fn($p) => str_starts_with($p, $rel . '/'));
    if (!$known) {
        $unlisted[] = ['name' => basename($dir), 'path' => $rel . '/', 'tags' => [], 'desc' => 'Not in registry.php yet.'];
    }
}
if ($unlisted) {
    $groups['unlisted'] = ['label' => 'Unlisted', 'items' => $unlisted];
}

// LAN-only tools are refused by .htaccess outside 127.0.0.1 / 192.168.x.x - show them locked there.
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$onLan = in_array($ip, ['127.0.0.1', '::1'], true) || str_starts_with($ip, '192.168.');

$TAGS = [
    'db'     => ['DB', 'Reads a WordPress database'],
    'writes' => ['Writes', 'Can change live data - every write asks for confirmation'],
    'multi'  => ['Multi-site', 'Switch between Landing (live), Botphonic and Old (local)'],
    'login'  => ['Login', 'Has its own login'],
    'lan'    => ['LAN only', 'Only reachable from this PC and the office network'],
    'api'    => ['No page', 'Used by other tools or holds files - nothing to open'],
    'node'   => ['Needs Node', 'Start its node server first'],
];

$total = array_sum(array_map(fn($g) => count($g['items']), $groups));
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
// Cache-bust the assets by their modification time.
$v = fn($f) => $f . '?v=' . (@filemtime(__DIR__ . '/' . $f) ?: 0);

/** Card icon: assets/icons/<name>.svg, an explicit SVG path, or the tool's initial. */
$icon = function (array $it) use ($e) {
    $src = $it['icon'] ?? '';
    if ($src !== '' && !str_contains($src, '/')) $src = "assets/icons/$src.svg";
    if ($src !== '' && is_file(__DIR__ . '/' . $src)) {
        return '<img class="ico" src="' . $e($src) . '" alt="" width="40" height="40">';
    }
    return '<span class="ico ico-letter" aria-hidden="true">' . $e(mb_strtoupper(mb_substr($it['name'], 0, 1))) . '</span>';
};
?>
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <title>Salvadore · Tools</title>
    <script>try { var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); document.documentElement.setAttribute('data-theme', t); } catch (e) { }</script>
    <link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="<?= $e($v('assets/home.css')) ?>">
    <script src="<?= $e($v('assets/home.js')) ?>" defer></script>
</head>

<body>
    <header class="top">
        <div class="brand">
            <span class="mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg></span>
            <div><b>Salvadore</b><small>Internal tools · Healthray · Botphonic · Bigscal</small></div>
        </div>
        <div class="top-end">
            <span class="net <?= $onLan ? 'lan' : 'ext' ?>" title="Your address: <?= $e($ip) ?>"><i></i><?= $onLan ? 'Office network' : 'Outside network — LAN-only tools locked' ?></span>
            <a class="chip-link" href="/phpmyadmin/" target="_blank" rel="noopener">phpMyAdmin ↗</a>
            <a class="chip-link" href="/dashboard/" target="_blank" rel="noopener">XAMPP ↗</a>
            <button class="chip-link icon-only" id="theme" type="button" aria-label="Toggle light/dark theme" title="Toggle light/dark theme">◐</button>
        </div>
    </header>

    <main>
        <div class="controls">
            <label class="search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></svg>
                <input id="q" type="search" placeholder="Search <?= $total ?> tools…" autocomplete="off" aria-label="Search tools">
                <span class="kbd" aria-hidden="true">/</span>
            </label>
            <div class="seg" id="groups" role="group" aria-label="Filter by group">
                <button type="button" class="active" data-group="">All <span class="n"><?= $total ?></span></button>
                <?php foreach ($groups as $key => $g): ?>
                    <button type="button" data-group="<?= $e($key) ?>"><?= $e(trim(strtok($g['label'], '—'))) ?> <span class="n"><?= count($g['items']) ?></span></button>
                <?php endforeach; ?>
            </div>
        </div>

        <section id="recent" hidden>
            <h2>Recently opened</h2>
            <div class="grid" id="recentGrid"></div>
        </section>

        <?php foreach ($groups as $key => $g): ?>
            <section data-group="<?= $e($key) ?>">
                <h2><?= $e($g['label']) ?> <span class="n"><?= count($g['items']) ?></span></h2>
                <div class="grid">
                    <?php foreach ($g['items'] as $it):
                        $tags = $it['tags'];
                        $locked = in_array('lan', $tags, true) && !$onLan;
                        $static = in_array('api', $tags, true) || $locked;
                        $tag = $static ? 'div' : 'a';
                        $cls = 'card' . (!empty($it['featured']) ? ' featured' : '') . ($static ? ' static' : '') . ($locked ? ' locked' : '');
                        $tip = $it['desc'] . ($locked ? ' (office network only)' : '') . "\n" . $it['path'];
                        $search = strtolower($it['name'] . ' ' . $it['desc'] . ' ' . $it['path'] . ' ' . implode(' ', array_map(fn($t) => $TAGS[$t][0] ?? $t, $tags)));
                    ?>
                        <<?= $tag ?> class="<?= $cls ?>" <?= $static ? '' : 'href="' . $e($it['path']) . '"' ?> title="<?= $e($tip) ?>" data-search="<?= $e($search) ?>" data-path="<?= $e($it['path']) ?>">
                            <?= $icon($it) ?>
                            <span class="body">
                                <span class="name"><?= $e($it['name']) ?></span>
                                <?php if ($tags || $locked): ?>
                                    <span class="tags"><?php foreach ($tags as $t): ?><span class="tag <?= $e($t) ?>" title="<?= $e($TAGS[$t][1] ?? '') ?>"><?= $e($TAGS[$t][0] ?? $t) ?></span><?php endforeach; ?><?= $locked ? '<span class="tag lan">Locked</span>' : '' ?></span>
                                <?php endif; ?>
                                <?php if (!empty($it['brand'])): ?>
                                    <span class="logos"><?php foreach (glob(__DIR__ . '/assets/brand/*.svg') ?: [] as $svg): ?><img class="<?= str_contains(basename($svg), 'white') ? 'on-dark' : '' ?>" src="assets/brand/<?= $e(basename($svg)) ?>" alt="<?= $e(basename($svg)) ?>" title="<?= $e(basename($svg)) ?>" loading="lazy"><?php endforeach; ?></span>
                                <?php endif; ?>
                            </span>
                            <?php if (!$static): ?><span class="go" aria-hidden="true">→</span><?php endif; ?>
                        </<?= $tag ?>>
                    <?php endforeach; ?>
                </div>
            </section>
        <?php endforeach; ?>

        <p class="empty" id="empty" hidden>No tools match “<span id="emptyQ"></span>”.</p>
        <footer>Add a tool: put it under <code>tools/</code> and list it in <code>registry.php</code> (icon in <code>assets/icons/</code>). Old URLs redirect automatically (<code>.htaccess</code>).</footer>
    </main>
</body>

</html>
