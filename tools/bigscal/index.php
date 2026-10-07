<?php
/*
 * Bigscal Directory Viewer: a read-only tree of this folder.
 * Dependencies, secrets and dotfiles are skipped - they're never useful to
 * open here and .htaccess refuses most of them anyway.
 */
const SKIP = '/^(\.|node_modules$|vendor$|service-account.*\.json$|package(-lock)?\.json$|composer\.(json|lock)$)/i';

$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

function tree(string $dir, string $rel = ''): array
{
    $dirs = $files = [];
    foreach (scandir($dir) ?: [] as $name) {
        if ($name === '.' || $name === '..' || preg_match(SKIP, $name) || ($rel === '' && $name === 'index.php')) {
            continue;
        }
        $path = $rel === '' ? $name : "$rel/$name";
        if (is_dir("$dir/$name")) {
            $hasIndex = is_file("$dir/$name/index.html") || is_file("$dir/$name/index.php");
            $dirs[] = ['name' => $name, 'path' => $path, 'hasIndex' => $hasIndex, 'children' => tree("$dir/$name", $path)];
        } else {
            $files[] = ['name' => $name, 'path' => $path, 'size' => filesize("$dir/$name")];
        }
    }
    return array_merge($dirs, $files);
}

function count_files(array $nodes): int
{
    $n = 0;
    foreach ($nodes as $node) {
        $n += isset($node['children']) ? count_files($node['children']) : 1;
    }
    return $n;
}

function render(array $nodes, callable $e): void
{
    echo '<ul>';
    foreach ($nodes as $node) {
        $url = implode('/', array_map('rawurlencode', explode('/', $node['path'])));
        if (isset($node['children'])) {
            echo '<li class="dir"><details open><summary><span class="ico">▸</span><span class="name">' . $e($node['name']) . '</span>';
            if ($node['hasIndex']) {
                echo '<a class="open" href="' . $e($url) . '/" target="_blank" rel="noopener">Open page ↗</a>';
            }
            echo '<span class="meta">' . count_files($node['children']) . ' files</span></summary>';
            render($node['children'], $e);
            echo '</details></li>';
        } else {
            $kb = $node['size'] < 1024 ? $node['size'] . ' B' : round($node['size'] / 1024, 1) . ' KB';
            echo '<li class="file"><a href="' . $e($url) . '" target="_blank" rel="noopener"><span class="name">' . $e($node['name']) . '</span></a><span class="meta">' . $kb . '</span></li>';
        }
    }
    echo '</ul>';
}

$nodes = tree(__DIR__);
?>
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <title>Bigscal · Directory Viewer</title>
    <script>try { var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); document.documentElement.setAttribute('data-theme', t); } catch (e) { }</script>
    <link rel="icon" href="../../assets/brand/favicon.svg" type="image/svg+xml">
    <style>
        :root {
            --bg: #0a0c14; --surface: #12151f; --surface2: #1a1e2c; --border: #262b40; --accent: #7c6cf6;
            --text: #eef0f8; --text2: #9aa0c0; --text3: #5b6084; --focus: 0 0 0 3px rgba(124, 108, 246, .35);
            --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
        }
        :root[data-theme="light"] {
            --bg: #f5f6fb; --surface: #fff; --surface2: #eef0f7; --border: #e1e4f0; --accent: #6552f6;
            --text: #161a2b; --text2: #5b6084; --text3: #8d92ac; --focus: 0 0 0 3px rgba(101, 82, 246, .2);
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
        a { color: inherit; }
        :focus-visible { outline: none; box-shadow: var(--focus); border-radius: 6px; }
        .top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; padding: 12px 24px;
            background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
        .chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
            background: var(--surface2); color: var(--text2); font: 600 12px var(--font); text-decoration: none; cursor: pointer; }
        .chip:hover { border-color: var(--accent); color: var(--accent); }
        .top b { font-size: 15px; }
        .top .end { margin-left: auto; display: flex; gap: 8px; }
        main { max-width: 960px; margin: 0 auto; padding: 22px 24px 48px; }
        h1 { margin: 0 0 2px; font-size: 22px; letter-spacing: -.02em; }
        .sub { margin: 0 0 16px; color: var(--text2); }
        .search { display: flex; align-items: center; height: 40px; padding: 0 12px; margin-bottom: 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); }
        .search:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
        .search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
        .panel { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 8px 6px; }
        ul { list-style: none; margin: 0; padding-left: 18px; }
        .panel > ul { padding-left: 4px; }
        li > a, summary { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; text-decoration: none; }
        li > a:hover, summary:hover { background: var(--surface2); }
        li > a .name { color: var(--text); }
        li > a:hover .name { color: var(--accent); }
        summary { cursor: pointer; list-style: none; font-weight: 600; }
        summary::-webkit-details-marker { display: none; }
        .ico { display: inline-block; width: 12px; color: var(--text3); transition: transform .15s; }
        details[open] > summary .ico { transform: rotate(90deg); }
        .file { display: flex; align-items: center; }
        .file > a { flex: 1; min-width: 0; font-family: var(--mono); font-size: 12.5px; }
        .meta { margin-left: auto; color: var(--text3); font-size: 11.5px; white-space: nowrap; padding-right: 8px; }
        .open { font-size: 11.5px; font-weight: 700; color: var(--accent); text-decoration: none; padding: 1px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); }
        .open:hover { background: var(--accent); color: #fff; }
        .empty { padding: 30px; text-align: center; color: var(--text3); }
        @media (max-width: 720px) { .top, main { padding-left: 16px; padding-right: 16px; } }
    </style>
</head>

<body>
    <header class="top">
        <a class="chip" href="../../">← All tools</a>
        <b>Bigscal</b>
        <div class="end"><button class="chip" id="theme" type="button" title="Toggle light/dark theme" aria-label="Toggle theme">◐</button></div>
    </header>
    <main>
        <h1>Directory Viewer</h1>
        <p class="sub"><?= count_files($nodes) ?> files in <code>tools/bigscal</code>. Dependencies and credential files are hidden.</p>
        <label class="search"><input id="q" type="search" placeholder="Filter files…" autocomplete="off" aria-label="Filter files"></label>
        <div class="panel">
            <?php if ($nodes) render($nodes, $e); else echo '<p class="empty">This folder is empty.</p>'; ?>
            <p class="empty" id="none" hidden>No files match.</p>
        </div>
    </main>
    <script>
        (() => {
            const q = document.getElementById('q');
            q.addEventListener('input', () => {
                const t = q.value.trim().toLowerCase();
                let shown = 0;
                document.querySelectorAll('li.file').forEach(li => {
                    const ok = !t || li.querySelector('.name').textContent.toLowerCase().includes(t);
                    li.hidden = !ok;
                    if (ok) shown++;
                });
                // Hide folders with nothing matching; open the ones that do.
                [...document.querySelectorAll('li.dir')].reverse().forEach(li => {
                    const any = li.querySelector('li.file:not([hidden])') || (t && li.querySelector('summary .name').textContent.toLowerCase().includes(t));
                    li.hidden = !any;
                    if (t && any) li.querySelector('details').open = true;
                });
                document.getElementById('none').hidden = shown > 0;
            });
            document.getElementById('theme').addEventListener('click', () => {
                const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('theme', next); } catch (e) { }
            });
        })();
    </script>
</body>

</html>
