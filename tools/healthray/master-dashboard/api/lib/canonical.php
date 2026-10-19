<?php
/*
 * Canonical audit: Yoast canonical URLs (`_yoast_wpseo_canonical`) that point
 * at a URL which no longer answers 200 - because a Yoast redirect (301/302/307
 * or 410/451) now fires for it, or because the post it named is trashed /
 * unpublished. A canonical like that tells Google "index that other URL
 * instead", and that other URL is gone or elsewhere.
 *
 * Read-only. Used by canonical_report.php (the Canonicals tab + CSV) and by
 * the "you just retired a URL - fix the canonicals that use it?" prompts
 * (same endpoint with `paths=`). Writes live in canonical_fix.php.
 *
 * Matching reuses the redirect store exactly as the Redirects tab does:
 * plain rules by dw_redirect_key(), regex rules via dw_redirect_matching_regexes(),
 * target posts via dw_resolve_paths_to_posts() (trash-aware, permalink-aware).
 */

require_once __DIR__ . '/redirects.php';

const DW_CANONICAL_KEY = '_yoast_wpseo_canonical';

/** Issue kinds, worst first. 'unmatched' is informational (archive/static URL - live-check to confirm). */
function dw_canonical_kinds()
{
    return [
        'gone'      => 'Canonical URL returns 410 Gone',
        'redirect'  => 'Canonical URL redirects',
        'not_live'  => 'Canonical post is trashed / not published',
        'unmatched' => 'Canonical URL matches no post (check live)',
    ];
}

/** "a/b?x=1" -> "a/b" (posts never match on the query string). */
function dw_canonical_strip_query($path)
{
    $q = strpos((string) $path, '?');
    return $q === false ? (string) $path : substr((string) $path, 0, $q);
}

/** Absolute URL for a site-relative path in Yoast's stored shape. */
function dw_canonical_abs($home, $path)
{
    if ($path === '') {
        return $home . '/';
    }
    return $home . '/' . $path . (strpos($path, '?') === false ? '/' : '');
}

/**
 * Follow plain 3xx rules from $rule until a non-redirect (max 5 hops, loop-safe).
 *
 * @return array{final:?string, gone:bool, external:bool, hops:array}
 *   final = site-relative path or external URL the chain ends at (null when it ends in a 410 or loops)
 */
function dw_canonical_follow(array $store, array $rule, $home)
{
    $hops = [];
    $seen = [];
    $cur  = $rule;
    for ($i = 0; $i < 5; $i++) {
        $hops[] = ['origin' => $cur['origin'], 'type' => (int) $cur['type'], 'url' => (string) $cur['url']];
        if (dw_redirect_type_is_gone($cur['type'])) {
            return ['final' => null, 'gone' => true, 'external' => false, 'hops' => $hops];
        }
        $n = dw_redirect_normalize((string) $cur['url'], $home);
        if ($n['external']) {
            return ['final' => $n['value'], 'gone' => false, 'external' => true, 'hops' => $hops];
        }
        $seen[dw_redirect_key($cur['origin'])] = true;
        $next = dw_redirect_find($store, $n['value']);
        if (!$next || isset($seen[dw_redirect_key($next['origin'])])) {
            return ['final' => isset($seen[dw_redirect_key($n['value'])]) ? null : $n['value'], 'gone' => false, 'external' => false, 'hops' => $hops];
        }
        $cur = $next;
    }
    return ['final' => null, 'gone' => false, 'external' => false, 'hops' => $hops];
}

/**
 * Every post (real types, not trashed) with a non-empty canonical, classified.
 *
 * @param string[]|null $onlyPaths Restrict to canonicals pointing at one of these
 *                                 URLs/paths (query ignored). null = whole site.
 * @return array{home:string, scanned:int, rows:array}
 *   rows: [{id, title, post_type, status, permalink, canonical, canonical_path,
 *           kind, kind_label, rule?, chain?, target_post?, suggested}]
 *   suggested = the URL a 3xx chain ends at (absolute), '' = remove the canonical.
 */
function dw_canonical_audit(mysqli $conn, ?array $onlyPaths = null, $includeUnmatched = true)
{
    $home  = dw_home_url($conn);
    $types = dw_known_post_types($conn);
    if (!$types) {
        return ['home' => $home, 'scanned' => 0, 'rows' => []];
    }

    $only = null;
    if ($onlyPaths !== null) {
        $only = [];
        foreach ($onlyPaths as $p) {
            $n = dw_redirect_normalize((string) $p, $home);
            if (!$n['external']) {
                $only[dw_redirect_key(dw_canonical_strip_query($n['value']))] = true;
            }
        }
        if (!$only) {
            return ['home' => $home, 'scanned' => 0, 'rows' => []];
        }
    }

    // MAX() = the value every other list in this tool shows for a duplicated meta row.
    $typePh = implode(',', array_fill(0, count($types), '?'));
    $stmt = $conn->prepare("SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug,
            p.post_status AS status, p.post_date, p.post_parent, MAX(m.meta_value) AS canonical
        FROM wp_posts p
        INNER JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key = ?
        WHERE p.post_type IN ($typePh) AND p.post_status NOT IN ('trash', 'auto-draft', 'inherit')
        GROUP BY p.ID, p.post_type, p.post_title, p.post_name, p.post_status, p.post_date, p.post_parent
        HAVING TRIM(canonical) <> ''");
    $params = [['type' => 's', 'value' => DW_CANONICAL_KEY]];
    foreach ($types as $t) {
        $params[] = ['type' => 's', 'value' => $t];
    }
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $posts = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $scanned = count($posts);

    // Normalize each canonical; external canonicals (cross-domain) are out of scope.
    $cands = [];
    foreach ($posts as $p) {
        $n = dw_redirect_normalize(trim((string) $p['canonical']), $home);
        if ($n['external']) {
            continue;
        }
        $path = $n['value'];
        if ($only !== null && !isset($only[dw_redirect_key(dw_canonical_strip_query($path))])) {
            continue;
        }
        $p['canonical_path'] = $path;
        $cands[] = $p;
    }
    if (!$cands) {
        return ['home' => $home, 'scanned' => $scanned, 'rows' => []];
    }

    $store   = dw_redirect_load($conn);
    $targets = dw_resolve_paths_to_posts($conn, array_map(fn($p) => dw_canonical_strip_query($p['canonical_path']), $cands));
    $live    = dw_live_statuses();
    $kinds   = dw_canonical_kinds();

    $issues = [];
    foreach ($cands as $p) {
        $path  = $p['canonical_path'];
        $issue = null;

        $rule = $path !== '' ? dw_redirect_find($store, $path) : null;
        if (!$rule && $path !== '') {
            $rx = dw_redirect_matching_regexes($store, $path);
            $rule = $rx ? $rx[0] : null;
        }
        if ($rule) {
            $rule = ['origin' => (string) $rule['origin'], 'url' => (string) $rule['url'], 'type' => (int) $rule['type'], 'format' => (string) $rule['format']];
            if (dw_redirect_type_is_gone($rule['type'])) {
                $issue = ['kind' => 'gone', 'rule' => $rule, 'suggested' => ''];
            } elseif ($rule['format'] === 'regex' && strpos($rule['url'], '$') !== false) {
                // A destination built from $1 back-references - no safe target to suggest.
                $issue = ['kind' => 'redirect', 'rule' => $rule, 'suggested' => ''];
            } else {
                $chain = dw_canonical_follow($store, $rule, $home);
                $suggested = $chain['final'] === null ? '' : ($chain['external'] ? $chain['final'] : dw_canonical_abs($home, $chain['final']));
                $issue = ['kind' => $chain['gone'] ? 'gone' : 'redirect', 'rule' => $rule, 'chain' => $chain['hops'], 'suggested' => $suggested];
            }
        } else {
            $target = $targets[trim(dw_canonical_strip_query($path), '/')] ?? null;
            if ($target !== null && !in_array($target['status'], $live, true)) {
                $issue = ['kind' => 'not_live', 'target_post' => $target, 'suggested' => ''];
            } elseif ($target === null && $path !== '' && $includeUnmatched) {
                $issue = ['kind' => 'unmatched', 'suggested' => ''];
            }
        }
        if ($issue) {
            $issues[] = $p + $issue;
        }
    }
    if (!$issues) {
        return ['home' => $home, 'scanned' => $scanned, 'rows' => []];
    }

    // Real permalinks of the posts that carry the canonical (chunked like the other lists).
    $permalinks = [];
    foreach (array_chunk($issues, 500) as $chunk) {
        foreach (dw_hydrate_batch($conn, $chunk) as $h) {
            $permalinks[$h['id']] = $h['permalink'];
        }
    }

    $rows = [];
    foreach ($issues as $p) {
        $rows[] = [
            'id'             => (int) $p['id'],
            'title'          => html_entity_decode((string) $p['title'], ENT_QUOTES),
            'post_type'      => $p['post_type'],
            'status'         => $p['status'],
            'permalink'      => $permalinks[(int) $p['id']] ?? '',
            'canonical'      => trim((string) $p['canonical']),
            'canonical_path' => $p['canonical_path'],
            'kind'           => $p['kind'],
            'kind_label'     => $kinds[$p['kind']],
            'live'           => in_array($p['status'], $live, true),
            'rule'           => $p['rule'] ?? null,
            'chain'          => $p['chain'] ?? null,
            'target_post'    => $p['target_post'] ?? null,
            'suggested'      => $p['suggested'],
        ];
    }
    // Live posts first (a draft's canonical is not public yet), then worst kind first.
    $order = array_flip(array_keys($kinds));
    $key = fn($r) => [in_array($r['status'], $live, true) ? 0 : 1, $order[$r['kind']], $r['canonical_path'], $r['id']];
    usort($rows, fn($a, $b) => $key($a) <=> $key($b));

    return ['home' => $home, 'scanned' => $scanned, 'rows' => $rows];
}

/** One-line description of where the canonical goes now, for the table + CSV. */
function dw_canonical_reason(array $r)
{
    if ($r['kind'] === 'gone' && !empty($r['chain']) && count($r['chain']) > 1) {
        return 'Redirect chain ends in a 410: ' . implode(' → ', array_map(fn($h) => $h['type'] . ' /' . $h['origin'] . '/', $r['chain']));
    }
    if (!empty($r['rule'])) {
        $rule = $r['rule'];
        $s = $rule['type'] . ' rule ' . ($rule['format'] === 'regex' ? $rule['origin'] . ' (regex)' : '/' . $rule['origin'] . '/');
        return $s . (dw_redirect_type_is_gone($rule['type']) ? ' (Gone)' : ' → ' . ($rule['url'] !== '' ? $rule['url'] : '/'));
    }
    if (!empty($r['target_post'])) {
        $t = $r['target_post'];
        return ucfirst($t['post_type']) . ' #' . $t['id'] . ' is ' . $t['status'];
    }
    return 'No post, page or redirect matches this URL';
}
