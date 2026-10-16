<?php
/*
 * Assets: every brand logo (brand/) and tool icon (icons/) with a preview,
 * size, the tool that uses it, and copy-URL / copy-<img> / download buttons.
 * Lists the folders at request time - drop a new SVG in and it shows up.
 * Read-only. See README.md in this folder for the conventions.
 */
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$v = fn($f) => $f . '?v=' . (@filemtime(__DIR__ . '/' . $f) ?: 0);

// icon name => tool name, from the dashboard registry
$usedBy = [];
foreach (require __DIR__ . '/../registry.php' as $g) {
    foreach ($g['items'] as $it) {
        if (!empty($it['icon'])) $usedBy[basename($it['icon'], '.svg')][] = $it['name'];
    }
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/';

$sets = [
    'brand' => ['Brand logos', 'Company logos and the site favicon. Other sites may link to these by name — never rename or delete one.'],
    'icons' => ['Tool icons', 'One per tool: its dashboard card icon and its browser-tab favicon (32×32, rounded square in the tool\'s colour).'],
];
$files = [];
foreach ($sets as $dir => $_) {
    $files[$dir] = [];
    foreach (glob(__DIR__ . "/$dir/*.svg") ?: [] as $path) {
        $name = basename($path);
        $svg = (string) @file_get_contents($path);
        $w = preg_match('/<svg[^>]*\swidth="([\d.]+)/', $svg, $m) ? $m[1] : '';
        $h = preg_match('/<svg[^>]*\sheight="([\d.]+)/', $svg, $m) ? $m[1] : '';
        $files[$dir][] = [
            'name' => $name,
            'src' => "$dir/$name",
            'url' => $base . "$dir/$name",
            'size' => filesize($path),
            'dims' => $w && $h ? "{$w}×{$h}" : '',
            'dark' => str_contains($name, 'white'),
            'used' => $usedBy[basename($name, '.svg')] ?? ($dir === 'brand' && $name === 'favicon.svg' ? ['Dashboard favicon'] : []),
        ];
    }
}
$kb = fn($b) => $b >= 1024 ? round($b / 1024, 1) . ' KB' : $b . ' B';
?>
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <title>Assets · Salvadore</title>
    <script>try { var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); document.documentElement.setAttribute('data-theme', t); } catch (e) { }</script>
    <link rel="icon" href="brand/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="<?= $e($v('home.css')) ?>">
    <style>
        .crumb { color: var(--text3); text-decoration: none; font-size: 12.5px; }
        .crumb:hover { color: var(--accent); }
        .set-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0 0 4px; }
        .set-head h1 { margin: 0; font-size: 18px; }
        .set-note { margin: 0 0 14px; color: var(--text2); font-size: 13px; }
        .bg-switch { margin-left: auto; }
        .agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-bottom: 30px; }
        .agrid.set-icons { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
        .asset { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
        .preview { display: grid; place-items: center; height: 130px; padding: 16px; border-bottom: 1px solid var(--border); }
        .set-icons .preview { height: 96px; }
        .preview img { display: block; max-width: 100%; max-height: 98px; width: auto; height: auto; object-fit: contain; }
        .set-icons .preview img { width: 48px; height: 48px; }
        [data-bg="light"] .preview { background: #fff; }
        [data-bg="dark"] .preview { background: #12151f; }
        [data-bg="check"] .preview { background: repeating-conic-gradient(#cfd3e1 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
        .meta { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; }
        .fname { font: 600 12.5px var(--mono); overflow-wrap: anywhere; }
        .sub { display: flex; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--text3); }
        .used { font-size: 11.5px; color: var(--text2); }
        .acts { display: flex; gap: 4px; padding: 0 12px 12px; }
        .acts button, .acts a { flex: 1; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px;
            background: var(--surface2); color: var(--text2); font: 600 11.5px var(--font); text-decoration: none; cursor: pointer; white-space: nowrap; }
        .acts a { flex: 0 0 34px; }
        .acts button:hover, .acts a:hover { border-color: var(--accent); color: var(--accent); }
        .acts .done { border-color: var(--ok); color: var(--ok); }
    </style>
</head>

<body data-bg="check">
    <header class="top">
        <div class="brand">
            <img src="brand/favicon.svg" alt="" width="32" height="32">
            <div><b>Assets</b><small><a class="crumb" href="../">← Salvadore tools</a></small></div>
        </div>
        <div class="top-end">
            <div class="seg bg-switch" id="bg" role="group" aria-label="Preview background">
                <button type="button" data-bg="check" class="active">Checker</button>
                <button type="button" data-bg="light">Light</button>
                <button type="button" data-bg="dark">Dark</button>
            </div>
            <button class="chip-link icon-only" id="theme" type="button" aria-label="Toggle light/dark theme" title="Toggle light/dark theme">◐</button>
        </div>
    </header>

    <main>
        <?php foreach ($sets as $dir => [$title, $note]): ?>
            <div class="set-head">
                <h1><?= $e($title) ?></h1>
                <span class="tag"><?= count($files[$dir]) ?> files · <?= $e($kb(array_sum(array_column($files[$dir], 'size')))) ?></span>
                <code class="sub"><?= $e("assets/$dir/") ?></code>
            </div>
            <p class="set-note"><?= $e($note) ?></p>
            <div class="agrid set-<?= $e($dir) ?>">
                <?php foreach ($files[$dir] as $f): ?>
                    <div class="asset">
                        <div class="preview"<?= $f['dark'] ? ' style="background:#12151f"' : '' ?>><img src="<?= $e($f['src']) ?>" alt="<?= $e($f['name']) ?>" loading="lazy"></div>
                        <div class="meta">
                            <span class="fname"><?= $e($f['name']) ?></span>
                            <span class="sub"><span><?= $e($kb($f['size'])) ?></span><?php if ($f['dims']): ?><span><?= $e($f['dims']) ?></span><?php endif; ?><?php if ($f['dark']): ?><span>for dark backgrounds</span><?php endif; ?></span>
                            <?php if ($f['used']): ?><span class="used"><?= $e(implode(', ', $f['used'])) ?></span><?php endif; ?>
                        </div>
                        <div class="acts">
                            <button type="button" data-copy="<?= $e($f['url']) ?>" title="Copy the URL: <?= $e($f['url']) ?>">URL</button>
                            <button type="button" data-copy="<?= $e('<img src="' . $f['url'] . '" alt="">') ?>" title="Copy an &lt;img&gt; tag">&lt;img&gt;</button>
                            <a href="<?= $e($f['src']) ?>" download title="Download <?= $e($f['name']) ?>" aria-label="Download <?= $e($f['name']) ?>">↓</a>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endforeach; ?>
        <footer>Conventions in <code>assets/README.md</code>. Tool icons are listed in <code>registry.php</code> (<code>icon</code> key).</footer>
    </main>

    <script>
        (() => {
            const copy = text => navigator.clipboard ? navigator.clipboard.writeText(text) : new Promise((ok, fail) => {
                // navigator.clipboard only exists on https/localhost; the LAN address is plain http.
                const ta = Object.assign(document.createElement('textarea'), { value: text });
                document.body.appendChild(ta); ta.select();
                const done = document.execCommand('copy'); ta.remove();
                done ? ok() : fail();
            });
            document.addEventListener('click', e => {
                const b = e.target.closest('[data-copy]');
                if (!b) return;
                const label = b.textContent;
                copy(b.dataset.copy).then(() => { b.textContent = '✓ Copied'; b.classList.add('done'); })
                    .catch(() => { b.textContent = 'Blocked'; })
                    .finally(() => setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1400));
            });
            const setBg = bg => {
                document.body.dataset.bg = bg;
                document.querySelectorAll('#bg button').forEach(x => x.classList.toggle('active', x.dataset.bg === bg));
                try { localStorage.setItem('assets.bg', bg); } catch (err) { }
            };
            document.getElementById('bg').addEventListener('click', e => { const b = e.target.closest('[data-bg]'); if (b) setBg(b.dataset.bg); });
            try { const bg = localStorage.getItem('assets.bg'); if (bg) setBg(bg); } catch (err) { }
            document.getElementById('theme').addEventListener('click', () => {
                const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('theme', next); } catch (err) { }
            });
        })();
    </script>
</body>

</html>
