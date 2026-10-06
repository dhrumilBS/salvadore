<?php
/*
 * Salvadore home: a launcher for every tool in this folder.
 * Tools are listed in registry.php; any folder under tools/, playground/ or
 * templates/ that isn't listed is still shown (under "Unlisted").
 * Read-only: this page never creates, edits or deletes anything.
 */
$groups = require __DIR__ . '/registry.php';

// Folders on disk the registry doesn't mention yet.
$listed = [];
foreach ($groups as $g) {
    foreach ($g['items'] as $it) {
        $listed[rtrim(strtok($it['path'], '#'), '/')] = true;
    }
}
$unlisted = [];
foreach (['tools', 'playground', 'templates'] as $root) {
    foreach (glob(__DIR__ . "/$root/*", GLOB_ONLYDIR) ?: [] as $dir) {
        $rel = $root . '/' . basename($dir);
        $known = isset($listed[$rel]) || array_filter(array_keys($listed), fn($p) => str_starts_with($p, $rel . '/'));
        if (!$known) {
            $unlisted[] = ['name' => basename($dir), 'path' => $rel . '/', 'tags' => [], 'desc' => 'Not in registry.php yet.'];
        }
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

$total = 0;
foreach ($groups as $g) {
    $total += count($g['items']);
}
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
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
    <style>
        :root {
            --bg: #0a0c14; --bg-2: #0d1019; --surface: #12151f; --surface2: #1a1e2c; --surface3: #232840;
            --border: #262b40; --accent: #7c6cf6; --accent-dim: #241f52; --text: #eef0f8; --text2: #9aa0c0; --text3: #5b6084;
            --ok: #2fd6a0; --ok-dim: #0f2e26; --warn: #ffb454; --warn-dim: #3a2a10; --danger: #ff6b7a; --danger-dim: #3a1620;
            --info: #38bdf8; --info-dim: #0c2a3a;
            --shadow: 0 8px 24px rgba(0, 0, 0, .35); --focus: 0 0 0 3px rgba(124, 108, 246, .35);
            --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
        }
        :root[data-theme="light"] {
            --bg: #f5f6fb; --bg-2: #eef0f7; --surface: #fff; --surface2: #eef0f7; --surface3: #e4e7f3;
            --border: #e1e4f0; --accent: #6552f6; --accent-dim: #ece9ff; --text: #161a2b; --text2: #5b6084; --text3: #8d92ac;
            --ok: #17a172; --ok-dim: #e6f7ef; --warn: #b8650a; --warn-dim: #fff2e0; --danger: #d63649; --danger-dim: #fdebef;
            --info: #0369a1; --info-dim: #e0f2fe;
            --shadow: 0 12px 28px rgba(30, 34, 60, .12); --focus: 0 0 0 3px rgba(101, 82, 246, .2);
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
        a { color: inherit; }
        :focus-visible { outline: none; box-shadow: var(--focus); border-radius: 8px; }

        .top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 24px;
            background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
        .brand { display: flex; align-items: center; gap: 10px; }
        .mark { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--accent), #4f8bff); }
        .brand b { font-size: 15px; letter-spacing: -.01em; }
        .brand small { display: block; color: var(--text3); font-size: 11.5px; }
        .top-end { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .chip-link { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
            background: var(--surface2); color: var(--text2); font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; font-family: inherit; }
        .chip-link:hover { border-color: var(--accent); color: var(--accent); }
        .net { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
        .net.lan { background: var(--ok-dim); color: var(--ok); }
        .net.ext { background: var(--warn-dim); color: var(--warn); }

        main { max-width: 1320px; margin: 0 auto; padding: 22px 24px 48px; }
        .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
        .hero h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
        .hero p { margin: 2px 0 0; color: var(--text2); }
        .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
        .search { flex: 1 1 320px; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 10px;
            border: 1px solid var(--border); background: var(--surface); color: var(--text3); }
        .search:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
        .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
        .kbd { font: 600 11px var(--mono); padding: 1px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 5px; color: var(--text3); }
        .seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface2); }
        .seg button { border: 0; background: transparent; color: var(--text2); font: 600 12.5px var(--font); padding: 6px 12px; border-radius: 7px; cursor: pointer; }
        .seg button:hover { color: var(--text); }
        .seg button.active { background: var(--accent); color: #fff; }
        .seg .n { opacity: .65; font-size: 11px; margin-left: 3px; }

        section { margin-bottom: 26px; }
        section h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text3); }
        section h2 .n { font-weight: 600; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
        .card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 14px 15px; border-radius: 12px; border: 1px solid var(--border);
            background: var(--surface); text-decoration: none; transition: border-color .15s, transform .12s, box-shadow .15s; min-height: 112px; }
        a.card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow); }
        .card.featured { grid-column: span 2; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface)); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
        .card.static { cursor: default; }
        .card.locked { opacity: .55; }
        .card h3 { margin: 0; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .card h3 .go { margin-left: auto; color: var(--text3); transition: transform .15s, color .15s; }
        a.card:hover h3 .go { color: var(--accent); transform: translateX(2px); }
        .card p { margin: 0; color: var(--text2); font-size: 12.5px; flex: 1; }
        .card .path { font: 11px var(--mono); color: var(--text3); overflow-wrap: anywhere; }
        .tags { display: flex; flex-wrap: wrap; gap: 4px; }
        .tag { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--surface3); color: var(--text2); cursor: help; }
        .tag.db { background: var(--info-dim); color: var(--info); }
        .tag.writes { background: var(--warn-dim); color: var(--warn); }
        .tag.lan { background: var(--danger-dim); color: var(--danger); }
        .tag.login, .tag.multi { background: var(--accent-dim); color: var(--accent); }
        .logos { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .logos img { height: 22px; max-width: 120px; background: #fff; border-radius: 5px; padding: 3px 6px; }
        .logos img.on-dark { background: #1b2033; }
        mark { background: color-mix(in srgb, var(--warn) 35%, transparent); color: inherit; border-radius: 2px; }
        .empty { display: none; padding: 50px 16px; text-align: center; color: var(--text3); }
        footer { color: var(--text3); font-size: 12px; text-align: center; padding-top: 10px; }
        footer code { font-family: var(--mono); }
        @media (max-width: 720px) {
            .top, main { padding-left: 16px; padding-right: 16px; }
            .card.featured { grid-column: auto; }
        }
    </style>
</head>

<body>
    <header class="top">
        <div class="brand">
            <span class="mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg></span>
            <div><b>Salvadore</b><small>Internal tools · Healthray · Botphonic · Bigscal</small></div>
        </div>
        <div class="top-end">
            <span class="net <?= $onLan ? 'lan' : 'ext' ?>" title="Your address: <?= $e($ip) ?>"><?= $onLan ? 'Office network' : 'Outside network — LAN-only tools locked' ?></span>
            <a class="chip-link" href="/phpmyadmin/" target="_blank" rel="noopener">phpMyAdmin ↗</a>
            <a class="chip-link" href="/dashboard/" target="_blank" rel="noopener">XAMPP ↗</a>
            <button class="chip-link" id="theme" type="button" aria-label="Toggle theme" title="Toggle light/dark theme">◐</button>
        </div>
    </header>

    <main>
        <div class="hero">
            <div>
                <h1>Tools</h1>
                <p><?= $total ?> tools and demos. Database tools ask before every write.</p>
            </div>
        </div>

        <div class="controls">
            <label class="search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></svg>
                <input id="q" type="search" placeholder="Search tools — name, description, path…" autocomplete="off" aria-label="Search tools">
                <span class="kbd" aria-hidden="true">/</span>
            </label>
            <div class="seg" id="groups" role="group" aria-label="Filter by group">
                <button type="button" class="active" data-group="">All <span class="n"><?= $total ?></span></button>
                <?php foreach ($groups as $key => $g): ?>
                    <button type="button" data-group="<?= $e($key) ?>"><?= $e(strtok($g['label'], '—')) ?> <span class="n"><?= count($g['items']) ?></span></button>
                <?php endforeach; ?>
            </div>
        </div>

        <?php foreach ($groups as $key => $g): ?>
            <section data-group="<?= $e($key) ?>">
                <h2><?= $e($g['label']) ?> <span class="n">· <?= count($g['items']) ?></span></h2>
                <div class="grid">
                    <?php foreach ($g['items'] as $it):
                        $tags = $it['tags'];
                        $exists = file_exists(__DIR__ . '/' . strtok($it['path'], '#'));
                        $locked = in_array('lan', $tags, true) && !$onLan;
                        $static = in_array('api', $tags, true) || !$exists || $locked;
                        $tag = $static ? 'div' : 'a';
                        $cls = 'card' . (!empty($it['featured']) ? ' featured' : '') . ($static ? ' static' : '') . ($locked ? ' locked' : '');
                        $search = strtolower($it['name'] . ' ' . $it['desc'] . ' ' . $it['path'] . ' ' . implode(' ', array_map(fn($t) => $TAGS[$t][0] ?? $t, $tags)));
                    ?>
                        <<?= $tag ?> class="<?= $cls ?>" <?= $static ? '' : 'href="' . $e($it['path']) . '"' ?> data-search="<?= $e($search) ?>">
                            <h3><span class="name"><?= $e($it['name']) ?></span><?php if (!$static): ?><span class="go" aria-hidden="true">→</span><?php endif; ?></h3>
                            <p class="desc"><?= $e($it['desc']) ?><?= !$exists ? ' <strong>(folder missing)</strong>' : '' ?><?= $locked ? ' <strong>(office network only)</strong>' : '' ?></p>
                            <?php if (!empty($it['brand'])): ?>
                                <div class="logos"><?php foreach (glob(__DIR__ . '/assets/brand/*.svg') ?: [] as $svg): ?><img class="<?= str_contains(basename($svg), 'white') ? 'on-dark' : '' ?>" src="assets/brand/<?= $e(basename($svg)) ?>" alt="<?= $e(basename($svg)) ?>" title="<?= $e(basename($svg)) ?>" loading="lazy"><?php endforeach; ?></div>
                            <?php endif; ?>
                            <?php if ($tags): ?>
                                <div class="tags"><?php foreach ($tags as $t): ?><span class="tag <?= $e($t) ?>" title="<?= $e($TAGS[$t][1] ?? '') ?>"><?= $e($TAGS[$t][0] ?? $t) ?></span><?php endforeach; ?></div>
                            <?php endif; ?>
                            <span class="path"><?= $e($it['path']) ?></span>
                        </<?= $tag ?>>
                    <?php endforeach; ?>
                </div>
            </section>
        <?php endforeach; ?>

        <p class="empty" id="empty">No tools match “<span id="emptyQ"></span>”.</p>
        <footer>Add a tool: put it under <code>tools/</code>, <code>playground/</code> or <code>templates/</code> and list it in <code>registry.php</code>. Old URLs redirect automatically (<code>.htaccess</code>).</footer>
    </main>

    <script>
        (() => {
            const q = document.getElementById('q');
            const cards = [...document.querySelectorAll('.card')];
            const sections = [...document.querySelectorAll('section[data-group]')];
            let group = '';
            const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            cards.forEach(c => { c._name = c.querySelector('.name').textContent; c._desc = c.querySelector('.desc').innerHTML; });

            function hl(text, terms) {
                let out = esc(text);
                terms.forEach(t => { out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`); });
                return out;
            }

            function apply() {
                const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
                let shown = 0;
                sections.forEach(s => {
                    let n = 0;
                    s.querySelectorAll('.card').forEach(c => {
                        const ok = (!group || s.dataset.group === group) && terms.every(t => c.dataset.search.includes(t));
                        c.hidden = !ok;
                        c.querySelector('.name').innerHTML = terms.length ? hl(c._name, terms) : esc(c._name);
                        if (ok) n++;
                    });
                    s.hidden = n === 0;
                    shown += n;
                });
                document.getElementById('empty').style.display = shown ? 'none' : 'block';
                document.getElementById('emptyQ').textContent = q.value;
                try { sessionStorage.setItem('home.q', q.value); sessionStorage.setItem('home.g', group); } catch (e) { }
            }

            q.addEventListener('input', apply);
            document.getElementById('groups').addEventListener('click', e => {
                const b = e.target.closest('button');
                if (!b) return;
                group = b.dataset.group;
                document.querySelectorAll('#groups button').forEach(x => x.classList.toggle('active', x === b));
                apply();
            });
            document.addEventListener('keydown', e => {
                if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
                if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; apply(); q.blur(); }
                if (e.key === 'Enter' && document.activeElement === q) {
                    const first = cards.find(c => !c.hidden && c.tagName === 'A');
                    if (first) location.href = first.href;
                }
            });
            document.getElementById('theme').addEventListener('click', () => {
                const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('theme', next); } catch (e) { }
            });

            // Come back to the same search/filter after opening a tool and pressing Back.
            try {
                q.value = sessionStorage.getItem('home.q') || '';
                const g = sessionStorage.getItem('home.g') || '';
                const btn = document.querySelector(`#groups button[data-group="${CSS.escape(g)}"]`);
                if (btn) btn.click(); else apply();
            } catch (e) { apply(); }
        })();
    </script>
</body>

</html>
