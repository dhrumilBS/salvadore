<?php
/*
 * Overview tab ("what needs fixing on this site today?"). Read-only.
 *
 * Remote sites sit ~220 ms away and every prepared statement costs two round
 * trips, so the core metrics are sent as ONE multi_query batch of plain
 * (escaped-literal) statements and everything else is computed in PHP:
 *
 *   ov_core()       content counts, SEO gaps, revisions, link totals
 *   ov_redirects()  Yoast redirect health - computed by the shared
 *                   lib/redirects.php functions (never reimplemented), and
 *                   memoised in the system temp dir under a fingerprint of
 *                   every input those functions read, so a repeat load costs
 *                   one batch instead of ~8 sequential prepared queries.
 *
 * "Real content types" = everything not in dw_excluded_post_types(), i.e. the
 * same set as dw_known_post_types() / filter_options.php.
 */

/** Revisions the ../version tool always keeps per post (the newest N). */
const OV_KEEP_REVISIONS = 5;

/** Fixed-width marker used to count regex matches inside SQL (see ov_core()). */
const OV_LINK_MARK = '~~MDLINK~~';

/** "'a','b',..." for an IN (...) list, escaped for this connection. */
function ov_sql_list(mysqli $conn, array $values)
{
    return implode(',', array_map(fn($v) => "'" . $conn->real_escape_string((string) $v) . "'", $values));
}

/**
 * Run several read-only statements in one round trip.
 * Returns one array of assoc rows per statement, in order.
 *
 * @throws RuntimeException on any SQL error
 */
function ov_multi(mysqli $conn, array $statements)
{
    $out = [];
    if (!$conn->multi_query(implode(";\n", $statements))) {
        throw new RuntimeException('Overview query failed: ' . $conn->error);
    }
    do {
        $res = $conn->store_result();
        if ($res instanceof mysqli_result) {
            $out[] = $res->fetch_all(MYSQLI_ASSOC);
            $res->free();
        } elseif ($conn->errno) {
            throw new RuntimeException('Overview query failed: ' . $conn->error);
        } else {
            $out[] = [];
        }
        if (!$conn->more_results()) {
            break;
        }
        if (!$conn->next_result()) {
            throw new RuntimeException('Overview query failed: ' . $conn->error);
        }
    } while (true);
    return $out;
}

/** Same normalisation the Focus Keywords tab uses for duplicates (fk_keyword_key()). */
function ov_kw_key($kw)
{
    return trim(strtolower((string) $kw));
}

/**
 * Content, SEO, revision and link metrics in one multi_query batch.
 *
 * @return array{site_home:string, site_name:string, content:array, seo:array, revisions:array, links:array}
 */
function ov_core(mysqli $conn)
{
    $excluded = ov_sql_list($conn, dw_excluded_post_types());
    $realType = "p.post_type NOT IN ($excluded)";
    $mark     = OV_LINK_MARK;
    $markLen  = strlen($mark);

    /*
     * Link counting without shipping post_content over the wire: each pattern
     * match is replaced by a fixed marker and counted by length difference.
     * Mirrors dw_extract_links(): an <a> with a non-empty href that is not
     * #fragment / mailto: / tel: / javascript:. External = absolute or
     * protocol-relative URL whose host is not exactly the site's home host
     * (taken from wp_options in the same statement, dots escaped).
     */
    $anyLink = "<a\\s[^>]*?href\\s*=\\s*[\"']?\\s*(?!#|mailto:|tel:|javascript:)[^\"'\\s>]";
    $extHead = "<a\\s[^>]*?href\\s*=\\s*[\"']?\\s*(https?:)?//(?!";
    $extTail = "[/:\"'?#\\s>])";
    $hostSql = "(SELECT REPLACE(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(option_value, '://', -1), '/', 1), ':', 1)), '.', '\\\\.')
                 FROM wp_options WHERE option_name = 'home' LIMIT 1)";
    $e = fn($s) => "'" . $conn->real_escape_string($s) . "'";
    $count = fn($col) => "COALESCE(SUM((LENGTH($col) - LENGTH(REPLACE($col, '$mark', ''))) / $markLen), 0)";

    $statements = [
        // 0: home + site name
        "SELECT option_name, option_value FROM wp_options WHERE option_name IN ('home', 'blogname')",
        // 1: posts per real type x status
        "SELECT p.post_type, p.post_status, COUNT(*) AS n FROM wp_posts p
         WHERE $realType AND p.post_status NOT IN ('auto-draft', 'inherit')
         GROUP BY p.post_type, p.post_status",
        // 2: one row per published post with the Yoast fields that matter (MAX() = kw_list.php's rule)
        "SELECT p.ID AS id, p.post_type,
                MAX(CASE WHEN m.meta_key = '_yoast_wpseo_title' THEN m.meta_value END) AS meta_title,
                MAX(CASE WHEN m.meta_key = '_yoast_wpseo_metadesc' AND TRIM(m.meta_value) <> '' THEN 1 ELSE 0 END) AS has_desc,
                MAX(CASE WHEN m.meta_key = '_yoast_wpseo_focuskw' THEN m.meta_value END) AS focus_kw
         FROM wp_posts p
         LEFT JOIN wp_postmeta m ON m.post_id = p.ID
             AND m.meta_key IN ('_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw')
         WHERE p.post_status = 'publish' AND $realType
         GROUP BY p.ID, p.post_type",
        // 3: revisions - same arithmetic as ../version/api.php?action=meta
        "SELECT COUNT(*) AS posts, COALESCE(SUM(c), 0) AS revisions,
                COALESCE(SUM(c > " . OV_KEEP_REVISIONS . "), 0) AS posts_over,
                COALESCE(SUM(GREATEST(c - " . OV_KEEP_REVISIONS . ", 0)), 0) AS deletable
         FROM (SELECT COUNT(*) AS c FROM wp_posts WHERE post_type = 'revision' GROUP BY post_parent) t",
        // 4: links in published content of real types
        "SELECT COUNT(*) AS posts, " . $count('a') . " AS total, " . $count('b') . " AS external
         FROM (SELECT REGEXP_REPLACE(p.post_content, " . $e($anyLink) . ", '$mark', 1, 0, 'i') AS a,
                      REGEXP_REPLACE(p.post_content, CONCAT(" . $e($extHead) . ", $hostSql, " . $e($extTail) . "), '$mark', 1, 0, 'i') AS b
               FROM wp_posts p WHERE p.post_status = 'publish' AND $realType) t",
    ];

    [$optRows, $typeRows, $seoRows, $revRows, $linkRows] = ov_multi($conn, $statements);

    $opts = array_column($optRows, 'option_value', 'option_name');

    // ── Content ──
    $statusKeys = ['publish', 'draft', 'pending', 'future', 'private', 'trash'];
    $types = [];
    $totals = array_fill_keys($statusKeys, 0);
    foreach ($typeRows as $r) {
        $t = $r['post_type'];
        $types[$t] ??= ['type' => $t, 'total' => 0] + array_fill_keys($statusKeys, 0);
        $n = (int) $r['n'];
        $types[$t]['total'] += $n;
        if (isset($totals[$r['post_status']])) {
            $types[$t][$r['post_status']] += $n;
            $totals[$r['post_status']] += $n;
        }
    }
    uasort($types, fn($a, $b) => [$b['publish'], $b['total']] <=> [$a['publish'], $a['total']]);

    // ── SEO gaps ──
    $byType = [];
    $kwGroups = [];     // type => kw key => count
    $titleGroups = [];  // normalised custom title => count (site-wide)
    $seo = ['published' => 0, 'missing_title' => 0, 'missing_desc' => 0, 'missing_kw' => 0,
        'dup_kw_posts' => 0, 'dup_kw_terms' => 0, 'dup_title_posts' => 0, 'dup_title_groups' => 0];
    foreach ($seoRows as $r) {
        $t = $r['post_type'];
        $byType[$t] ??= ['published' => 0, 'missing_title' => 0, 'missing_desc' => 0, 'missing_kw' => 0, 'dup_kw_posts' => 0, 'dup_kw_terms' => 0];
        $byType[$t]['published']++;
        $seo['published']++;

        $title = trim((string) ($r['meta_title'] ?? ''));
        if ($title === '') {
            $byType[$t]['missing_title']++;
            $seo['missing_title']++;
        } elseif (strpos($title, '%%') === false) {
            // Titles built from Yoast variables (%%title%% ...) render differently per post - only literal ones can clash.
            $key = mb_strtolower($title);
            $titleGroups[$key] = ($titleGroups[$key] ?? 0) + 1;
        }
        if (!(int) $r['has_desc']) {
            $byType[$t]['missing_desc']++;
            $seo['missing_desc']++;
        }
        $kw = ov_kw_key($r['focus_kw'] ?? '');
        if ($kw === '') {
            $byType[$t]['missing_kw']++;
            $seo['missing_kw']++;
        } else {
            $kwGroups[$t][$kw] = ($kwGroups[$t][$kw] ?? 0) + 1;
        }
    }
    // Duplicates are counted per post type, exactly like the Focus Keywords tab (one type + status at a time).
    foreach ($kwGroups as $t => $groups) {
        foreach ($groups as $n) {
            if ($n > 1) {
                $byType[$t]['dup_kw_posts'] += $n;
                $byType[$t]['dup_kw_terms']++;
                $seo['dup_kw_posts'] += $n;
                $seo['dup_kw_terms']++;
            }
        }
    }
    foreach ($titleGroups as $n) {
        if ($n > 1) {
            $seo['dup_title_posts'] += $n;
            $seo['dup_title_groups']++;
        }
    }
    uasort($byType, fn($a, $b) => $b['published'] <=> $a['published']);
    $seo['by_type'] = $byType;

    $rev  = $revRows[0] ?? [];
    $link = $linkRows[0] ?? [];
    $linkTotal = (int) round((float) ($link['total'] ?? 0));
    $linkExt   = (int) round((float) ($link['external'] ?? 0));

    return [
        'site_home' => rtrim((string) ($opts['home'] ?? ''), '/'),
        'site_name' => (string) ($opts['blogname'] ?? ''),
        'content'   => ['totals' => $totals, 'types' => array_values($types)],
        'seo'       => $seo,
        'revisions' => [
            'keep'       => OV_KEEP_REVISIONS,
            'posts'      => (int) ($rev['posts'] ?? 0),
            'revisions'  => (int) ($rev['revisions'] ?? 0),
            'posts_over' => (int) ($rev['posts_over'] ?? 0),
            'deletable'  => (int) ($rev['deletable'] ?? 0),
        ],
        'links' => [
            'posts'    => (int) ($link['posts'] ?? 0),
            'total'    => $linkTotal,
            'external' => $linkExt,
            'internal' => max(0, $linkTotal - $linkExt),
        ],
    ];
}

/**
 * Fingerprint of everything dw_load_yoast_redirects() + dw_attach_redirect_matches()
 * read: the redirect options + permalink structure, every real-type post's
 * slug/status/parent/date, the category tree, category assignments and Yoast
 * primary categories. One multi_query batch.
 */
function ov_redirect_fingerprint(mysqli $conn)
{
    $opts = ov_sql_list($conn, [DW_OPT_REDIRECT_BASE, DW_OPT_REDIRECT_PLAIN, DW_OPT_REDIRECT_REGEX, 'permalink_structure', 'home']);
    $excluded = ov_sql_list($conn, dw_excluded_post_types());
    $rows = ov_multi($conn, [
        "SELECT COUNT(*) AS n, COALESCE(GROUP_CONCAT(option_name, ':', MD5(option_value) ORDER BY option_name), '') AS h
         FROM wp_options WHERE option_name IN ($opts)",
        "SELECT COUNT(*) AS n, COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', ID, post_type, post_status, post_name, post_parent, post_date))), 0) AS h
         FROM wp_posts WHERE post_type NOT IN ($excluded)",
        "SELECT COUNT(*) AS n, COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', tt.term_id, tt.term_taxonomy_id, tt.parent, t.slug))), 0) AS h
         FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id = tt.term_id WHERE tt.taxonomy = 'category'",
        "SELECT COUNT(*) AS n, COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', object_id, term_taxonomy_id))), 0) AS h FROM wp_term_relationships",
        "SELECT COUNT(*) AS n, COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', post_id, meta_value))), 0) AS h
         FROM wp_postmeta WHERE meta_key = '_yoast_wpseo_primary_category'",
    ]);
    $parts = array_map(fn($r) => ($r[0]['n'] ?? '') . '/' . ($r[0]['h'] ?? ''), $rows);
    return md5(implode('#', $parts));
}

/** Memo file for one site's redirect metrics (system temp dir - not web-reachable, not the DB). */
function ov_redirect_cache_file($dbKey)
{
    return rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'md-overview-redirects-'
        . preg_replace('/[^a-z0-9_-]+/i', '-', (string) $dbKey) . '.json';
}

/**
 * Redirect health. Counts use the exact buckets of the Redirects tab's
 * "Redirection status" filter (dw_apply_redirect_match_filter()).
 *
 * @return array{total:int, plain:int, regex:int, conflicts:int, dest_missing:int, healthy:int, gone_410:int, by_type:array, cached:bool}
 */
function ov_redirects(mysqli $conn, $dbKey, $fresh = false)
{
    $fingerprint = ov_redirect_fingerprint($conn);
    $file = ov_redirect_cache_file($dbKey);
    if (!$fresh && is_file($file)) {
        $memo = json_decode((string) @file_get_contents($file), true);
        if (is_array($memo) && ($memo['fingerprint'] ?? '') === $fingerprint && is_array($memo['data'] ?? null)) {
            return $memo['data'] + ['cached' => true];
        }
    }

    $rows = dw_load_yoast_redirects($conn);
    $byType = [];
    $plain = 0;
    foreach ($rows as $r) {
        $byType[(string) $r['type']] = ($byType[(string) $r['type']] ?? 0) + 1;
        if ($r['format'] === 'plain') {
            $plain++;
        }
    }
    ksort($byType);
    $rows = dw_attach_redirect_matches($conn, $rows);

    $data = [
        'total'        => count($rows),
        'plain'        => $plain,
        'regex'        => count($rows) - $plain,
        'conflicts'    => count(dw_apply_redirect_match_filter($rows, 'origin_live')),
        'dest_missing' => count(dw_apply_redirect_match_filter($rows, 'dest_missing')),
        'healthy'      => count(dw_apply_redirect_match_filter($rows, 'healthy')),
        'gone_410'     => $byType['410'] ?? 0,
        'by_type'      => (object) $byType,
    ];
    @file_put_contents($file, json_encode(['fingerprint' => $fingerprint, 'at' => date('c'), 'data' => $data]), LOCK_EX);
    return $data + ['cached' => false];
}
