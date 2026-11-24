<?php
/*
 * Internal links tab (js/internal.js): one pass over every published post's content + FAQ answers.
 *
 *  - Inbound links per post: how many other published posts link to it (unique source posts) and
 *    how many links that is; "orphan" = no published post links to it. Only links inside post
 *    content / FAQ answers count - menus, footers, widgets and PHP page templates are not in the
 *    database as post content, so a page linked only from the menu still shows as an orphan here.
 *  - Links to retired URLs: internal links whose target has a Yoast rule (410 Gone, or a 3xx,
 *    chain followed to its end) or is a trashed / unpublished post with no rule (a 404). Matched
 *    against the redirect store, never live-checked, so the whole site audits in one request.
 *
 * Targets are matched on the real permalinks of the published posts (dw_hydrate_batch), so a
 * link to "/blog/x/" counts for the post whose permalink is that path, front page = "/".
 */

require_once __DIR__ . '/redirects.php';
require_once __DIR__ . '/canonical.php';
require_once __DIR__ . '/link_editor.php';

/**
 * Link URLs inside one Elementor layout (_elementor_data JSON): every "url" setting (buttons, icon boxes,
 * image links) and every <a href> in text/HTML widgets. Media files come through too - they match no
 * post and no rule, so they're ignored downstream.
 */
function dw_il_elementor_urls($json)
{
    $data = json_decode((string) $json, true);
    if (!is_array($data)) {
        return [];
    }
    $urls = [];
    $walk = function ($node, $key = '') use (&$walk, &$urls) {
        if (is_array($node)) {
            foreach ($node as $k => $v) {
                $walk($v, (string) $k);
            }
            return;
        }
        if (!is_string($node) || $node === '') {
            return;
        }
        if ($key === 'url' && preg_match('#^(https?://|/)#i', $node)) {
            $urls[] = $node;
        } elseif (stripos($node, '<a') !== false && preg_match_all(DW_FX_A_OPEN, $node, $m)) {
            foreach ($m[2] as $href) {
                $urls[] = html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
        }
    };
    $walk($data);
    return $urls;
}

/** "Blog/X/?a=1#top" -> "blog/x" - the key a link and a permalink are compared on. */
function dw_il_key($path)
{
    $path = (string) $path;
    foreach (['#', '?'] as $c) {
        $p = strpos($path, $c);
        if ($p !== false) {
            $path = substr($path, 0, $p);
        }
    }
    return strtolower(trim($path, '/'));
}

/**
 * @return array{home:string, scanned:int, capped:bool, posts:array, links:array}
 *   posts: [{id, title, post_type, status, permalink, indexable, is_front, inbound, inbound_links, outbound, sources:int[]}]
 *   links: [{source_id, source_title, source_permalink, source, meta_key, href, url, anchor, count,
 *            kind: gone|redirect|not_live, rule_type, rule_url, final, hops, target_title}]
 */
function dw_internal_links_audit(mysqli $conn)
{
    $home  = dw_home_url($conn);
    $types = dw_known_post_types($conn);
    $cap   = dw_links_row_cap();
    if (!$types) {
        return ['home' => $home, 'scanned' => 0, 'capped' => false, 'posts' => [], 'links' => []];
    }

    $ph = implode(',', array_fill(0, count($types), '?'));
    $stmt = $conn->prepare("SELECT ID AS id, post_type, post_title AS title, post_name AS slug, post_status AS status,
            post_date, post_parent, post_content
        FROM wp_posts WHERE post_status = 'publish' AND post_type IN ($ph) ORDER BY ID LIMIT ?");
    $params = array_map(fn($t) => ['type' => 's', 'value' => $t], $types);
    $params[] = ['type' => 'i', 'value' => $cap + 1];
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $capped = count($rows) > $cap;
    $rows = array_slice($rows, 0, $cap);

    $content = [];
    foreach ($rows as &$r) {
        $content[(int) $r['id']] = (string) $r['post_content'];
        unset($r['post_content']); // hydrate doesn't need it - keep memory down
    }
    unset($r);

    $hydrated = [];
    foreach (array_chunk($rows, 500) as $chunk) {
        foreach (dw_hydrate_batch($conn, $chunk) as $h) {
            $hydrated[(int) $h['id']] = $h;
        }
    }
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'page_on_front' LIMIT 1");
    $frontId = (int) (($res ? $res->fetch_row() : null)[0] ?? 0);

    // permalink key -> post id (front page also answers at "/")
    $byKey = [];
    foreach ($hydrated as $id => $h) {
        $byKey[dw_il_key($h['path'])] ??= $id;
    }
    if ($frontId && isset($hydrated[$frontId])) {
        $byKey[''] = $frontId;
    }

    $faq = [];
    $elementor = [];
    foreach (array_chunk(array_keys($hydrated), 500) as $chunk) {
        $faq += dw_fx_faq_fields($conn, $chunk);
        $phc = implode(',', array_fill(0, count($chunk), '?'));
        $stmt = $conn->prepare("SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = '_elementor_data' AND post_id IN ($phc)");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $chunk));
        $stmt->execute();
        $res = $stmt->get_result();
        while ($m = $res->fetch_assoc()) {
            $elementor[(int) $m['post_id']] = $m['meta_value'];
        }
    }

    // Posts in a navigation menu (by object, or a custom-URL item pointing at their permalink) aren't orphans in practice.
    $inMenu = [];
    $res = $conn->query("SELECT t.meta_value AS item_type, o.meta_value AS object_id, u.meta_value AS url
        FROM wp_posts mi
        INNER JOIN wp_postmeta t ON t.post_id = mi.ID AND t.meta_key = '_menu_item_type'
        LEFT JOIN wp_postmeta o ON o.post_id = mi.ID AND o.meta_key = '_menu_item_object_id'
        LEFT JOIN wp_postmeta u ON u.post_id = mi.ID AND u.meta_key = '_menu_item_url'
        WHERE mi.post_type = 'nav_menu_item' AND mi.post_status = 'publish'");
    foreach ($res ? $res->fetch_all(MYSQLI_ASSOC) : [] as $mi) {
        if ($mi['item_type'] === 'post_type') {
            $inMenu[(int) $mi['object_id']] = true;
        } elseif ($mi['item_type'] === 'custom' && trim((string) $mi['url']) !== '') {
            $n = dw_redirect_normalize((string) $mi['url'], $home);
            if (!$n['external'] && isset($byKey[dw_il_key($n['value'])])) {
                $inMenu[$byKey[dw_il_key($n['value'])]] = true;
            }
        }
    }

    $siteHost = dw_fx_bare_host($home);
    $inbound = [];      // target id => [source id => true]
    $inboundLinks = []; // target id => n
    $outbound = [];     // source id => [target id => true]
    $pending = [];      // unknown internal links, classified below: [source, field, meta_key, link, key, path]

    foreach ($hydrated as $sid => $h) {
        $fields = [['content', null, $content[$sid] ?? '']];
        foreach ($faq[$sid] ?? [] as $f) {
            $fields[] = ['faq', $f['meta_key'], (string) $f['meta_value']];
        }
        // Elementor layout: its links count too (buttons often exist only here). Read-only - the Link Fixer
        // can't rewrite Elementor JSON, so a retired link found only here is fixed in Elementor.
        if (isset($elementor[$sid])) {
            $html = implode('', array_map(fn($u) => '<a href="' . htmlspecialchars($u, ENT_QUOTES) . '">el</a>', dw_il_elementor_urls($elementor[$sid])));
            $fields[] = ['elementor', null, $html];
        }
        $seenPair = []; // "target" => true per source: Elementor repeats what post_content already has
        foreach ($fields as [$field, $metaKey, $html]) {
            foreach (dw_fx_extract_links($html, $h['permalink'], $siteHost) as $l) {
                if (!$l['is_internal']) {
                    continue;
                }
                $n = dw_redirect_normalize($l['url'], $home);
                if ($n['external']) {
                    continue;
                }
                $key = dw_il_key($n['value']);
                $tid = $byKey[$key] ?? null;
                if ($tid !== null) {
                    // Elementor's copy of a link already counted from post_content isn't a second link.
                    if ($tid !== $sid && !($field === 'elementor' && isset($seenPair[$tid]))) {
                        $inbound[$tid][$sid] = true;
                        $inboundLinks[$tid] = ($inboundLinks[$tid] ?? 0) + 1;
                        $outbound[$sid][$tid] = true;
                        if ($field !== 'elementor') {
                            $seenPair[$tid] = true;
                        }
                    }
                    continue;
                }
                if ($field === 'elementor' && isset($seenPair['?' . $key])) {
                    continue;
                }
                if ($field !== 'elementor') {
                    $seenPair['?' . $key] = true;
                }
                $pending[] = [$sid, $field, $metaKey, $l, $key, $n['value']];
            }
        }
    }

    // ── classify links that hit no published post: redirect rule, retired post, or neither (archive/file - ignored) ──
    $store = dw_redirect_load($conn);
    $unknownKeys = array_values(array_unique(array_filter(array_column($pending, 4), fn($k) => $k !== '')));
    $retiredPosts = $unknownKeys ? dw_resolve_paths_to_posts($conn, $unknownKeys) : [];
    $live = dw_live_statuses();

    $links = [];
    foreach ($pending as [$sid, $field, $metaKey, $l, $key, $path]) {
        $issue = null;
        $rule = $key !== '' ? dw_redirect_find($store, dw_canonical_strip_query($path)) : null;
        if (!$rule && $key !== '') {
            $rx = dw_redirect_matching_regexes($store, dw_canonical_strip_query($path));
            $rule = $rx ? $rx[0] : null;
        }
        if ($rule) {
            $rule = ['origin' => (string) $rule['origin'], 'url' => (string) $rule['url'], 'type' => (int) $rule['type'], 'format' => (string) $rule['format']];
            if (dw_redirect_type_is_gone($rule['type'])) {
                $issue = ['kind' => 'gone', 'final' => '', 'hops' => 1];
            } elseif ($rule['format'] === 'regex' && strpos($rule['url'], '$') !== false) {
                $issue = ['kind' => 'redirect', 'final' => '', 'hops' => 1]; // $1 back-reference: no safe target
            } else {
                $f = dw_canonical_follow($store, $rule, $home);
                $final = $f['final'] === null ? '' : ($f['external'] ? $f['final'] : dw_canonical_abs($home, $f['final']));
                $issue = ['kind' => $f['gone'] ? 'gone' : 'redirect', 'final' => $final, 'hops' => count($f['hops'])];
            }
            $issue += ['rule_type' => $rule['type'], 'rule_url' => $rule['url'], 'target_title' => ''];
        } else {
            $p = $retiredPosts[$key] ?? null;
            if ($p !== null && !in_array($p['status'], $live, true)) {
                $issue = ['kind' => 'not_live', 'final' => '', 'hops' => 0, 'rule_type' => null, 'rule_url' => '',
                    'target_title' => html_entity_decode((string) $p['title'], ENT_QUOTES) . ' (' . $p['status'] . ')'];
            }
        }
        if (!$issue) {
            continue;
        }
        $k = $sid . '|' . $field . '|' . $metaKey . '|' . $l['href'];
        if (isset($links[$k])) {
            $links[$k]['count']++;
            continue;
        }
        $links[$k] = [
            'source_id'        => $sid,
            'source_title'     => html_entity_decode((string) $hydrated[$sid]['title'], ENT_QUOTES),
            'source_permalink' => $hydrated[$sid]['permalink'],
            'source'           => $field,
            'meta_key'         => $metaKey,
            'href'             => $l['href'],
            'url'              => $l['url'],
            'anchor'           => $field === 'elementor' ? '(Elementor widget)' : $l['anchor_text'],
            'count'            => 1,
        ] + $issue;
    }

    $posts = [];
    foreach ($hydrated as $id => $h) {
        $noindex = $h['robots_index'] === 'noindex' || ($h['robots_index'] === '' && !$h['robots_index_default']);
        $posts[] = [
            'id'            => $id,
            'title'         => html_entity_decode((string) $h['title'], ENT_QUOTES),
            'post_type'     => $h['post_type'],
            'status'        => $h['status'],
            'permalink'     => $id === $frontId ? $home . '/' : $h['permalink'],
            'indexable'     => !$noindex,
            'is_front'      => $id === $frontId,
            'in_menu'       => isset($inMenu[$id]),
            'inbound'       => count($inbound[$id] ?? []),
            'inbound_links' => $inboundLinks[$id] ?? 0,
            'outbound'      => count($outbound[$id] ?? []),
            'sources'       => array_keys($inbound[$id] ?? []),
        ];
    }
    $order = ['gone' => 0, 'not_live' => 1, 'redirect' => 2];
    $links = array_values($links);
    usort($links, fn($a, $b) => [$order[$a['kind']], $a['source_title']] <=> [$order[$b['kind']], $b['source_title']]);

    return ['home' => $home, 'scanned' => count($hydrated), 'capped' => $capped, 'posts' => $posts, 'links' => $links];
}
