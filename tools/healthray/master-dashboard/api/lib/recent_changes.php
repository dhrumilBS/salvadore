<?php
/*
 * Recent changes (js/changes.js): every post modified in the last N days and how it was changed,
 * worked out from what the database and this dashboard already record - nothing is logged by WordPress
 * for us, so "how" is evidence, not certainty:
 *
 *   dashboard - this dashboard's activity log has an entry for the post within DW_RC_MATCH_SECONDS
 *   editor    - WordPress saved a revision of it within DW_RC_MATCH_SECONDS (WP editor / Elementor save);
 *               the revision's author is who saved it
 *   unknown   - neither: a plugin, import, cron job, script or direct database write. Post types without
 *               revision support land here too when edited in WP admin, so "unknown" alone isn't alarming;
 *               many posts at once is (see batches).
 *
 * Batches: DW_RC_BULK_MIN+ posts modified in the same minute = one bulk change (a script, plugin update,
 * import, find-and-replace...). The 2026-11-23 08:57 UTC change of ~100 posts across both sites is the
 * case this exists for.
 */

require_once __DIR__ . '/activity.php';

const DW_RC_MATCH_SECONDS = 180;
const DW_RC_BULK_MIN      = 10;
const DW_RC_MAX_ROWS      = 3000;

/**
 * @return array{days:int, since_gmt:string, capped:bool, changes:array, batches:array, uploads:int, home:string}
 */
function dw_recent_changes(mysqli $conn, string $dbKey, int $days)
{
    $days = max(1, min(90, $days));
    $since = gmdate('Y-m-d H:i:s', time() - $days * 86400);
    $excluded = array_merge(dw_excluded_post_types(), ['attachment', 'revision', 'nav_menu_item', 'customize_changeset', 'oembed_cache', 'user_request']);
    $exPh = implode(',', array_fill(0, count($excluded), '?'));

    // The revision saved closest to the modification (within the window) and its author.
    $win = DW_RC_MATCH_SECONDS;
    $stmt = $conn->prepare("SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug, p.post_status AS status,
            p.post_parent, p.post_date, p.post_modified, p.post_modified_gmt,
            (SELECT r.post_author FROM wp_posts r WHERE r.post_parent = p.ID AND r.post_type = 'revision'
                AND ABS(TIMESTAMPDIFF(SECOND, r.post_date_gmt, p.post_modified_gmt)) <= $win
                ORDER BY ABS(TIMESTAMPDIFF(SECOND, r.post_date_gmt, p.post_modified_gmt)) LIMIT 1) AS rev_author,
            (SELECT MAX(e.meta_value) FROM wp_postmeta e WHERE e.post_id = p.ID AND e.meta_key = '_edit_last') AS edit_last
        FROM wp_posts p
        WHERE p.post_modified_gmt >= ? AND p.post_type NOT IN ($exPh) AND p.post_status NOT IN ('auto-draft', 'inherit')
        ORDER BY p.post_modified_gmt DESC, p.ID DESC
        LIMIT ?");
    $params = [['type' => 's', 'value' => $since]];
    foreach ($excluded as $t) {
        $params[] = ['type' => 's', 'value' => $t];
    }
    $params[] = ['type' => 'i', 'value' => DW_RC_MAX_ROWS + 1];
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $capped = count($rows) > DW_RC_MAX_ROWS;
    $rows = array_slice($rows, 0, DW_RC_MAX_ROWS);

    $users = [];
    $res = $conn->query('SELECT ID, display_name, user_login FROM wp_users');
    foreach ($res ? $res->fetch_all(MYSQLI_ASSOC) : [] as $u) {
        $users[(int) $u['ID']] = $u['display_name'] !== '' ? $u['display_name'] : $u['user_login'];
    }

    // This dashboard's own writes in the window: post id => [[unix time, source, summary], ...]
    $mine = [];
    $sinceTs = strtotime($since . ' UTC') - DW_RC_MATCH_SECONDS;
    foreach (md_activity_read($dbKey) as $e) {
        $ts = strtotime((string) ($e['time'] ?? ''));
        if (!$ts || $ts < $sinceTs) {
            continue;
        }
        $ids = $e['post_ids'] ?? array_column(array_filter($e['changes'] ?? [], fn($c) => isset($c['post_id'])), 'post_id');
        foreach (array_unique(array_map('intval', (array) $ids)) as $pid) {
            $mine[$pid][] = [$ts, (string) ($e['source'] ?? ''), (string) ($e['summary'] ?? '')];
        }
    }

    // Permalinks for display (chunked like every other list).
    $permalinks = [];
    foreach (array_chunk(array_map(fn($r) => $r + ['id' => (int) $r['id']], $rows), 500) as $chunk) {
        foreach (dw_hydrate_batch($conn, $chunk) as $h) {
            $permalinks[$h['id']] = $h['permalink'];
        }
    }

    $changes = [];
    $byMinute = [];
    foreach ($rows as $r) {
        $id = (int) $r['id'];
        $ts = strtotime($r['post_modified_gmt'] . ' UTC');
        $via = 'unknown';
        $who = '';
        $note = '';
        foreach ($mine[$id] ?? [] as [$t, $src, $sum]) {
            if (abs($t - $ts) <= DW_RC_MATCH_SECONDS) {
                $via = 'dashboard';
                $note = $sum;
                break;
            }
        }
        if ($via === 'unknown' && $r['rev_author'] !== null) {
            $via = 'editor';
            $who = $users[(int) $r['rev_author']] ?? ('user #' . $r['rev_author']);
        }
        $minute = substr($r['post_modified_gmt'], 0, 16);
        $byMinute[$minute][] = count($changes);
        $changes[] = [
            'id'           => $id,
            'title'        => html_entity_decode((string) $r['title'], ENT_QUOTES),
            'post_type'    => $r['post_type'],
            'status'       => $r['status'],
            'permalink'    => $permalinks[$id] ?? '',
            'modified'     => $r['post_modified'],      // site time
            'modified_gmt' => $r['post_modified_gmt'],
            'via'          => $via,
            'who'          => $who,
            'last_editor'  => $r['edit_last'] !== null ? ($users[(int) $r['edit_last']] ?? '') : '', // last WP-admin editor, any date
            'note'         => $note,
            'batch'        => '',
        ];
    }

    $batches = [];
    foreach ($byMinute as $minute => $idx) {
        if (count($idx) < DW_RC_BULK_MIN) {
            continue;
        }
        $via = [];
        $types = [];
        $seconds = [];
        foreach ($idx as $i) {
            $changes[$i]['batch'] = $minute;
            $via[$changes[$i]['via']] = ($via[$changes[$i]['via']] ?? 0) + 1;
            $types[$changes[$i]['post_type']] = ($types[$changes[$i]['post_type']] ?? 0) + 1;
            $seconds[$changes[$i]['modified_gmt']] = true;
        }
        arsort($types);
        $first = $changes[$idx[count($idx) - 1]];
        $batches[] = [
            'minute_gmt'   => $minute,
            'modified'     => substr($first['modified'], 0, 16), // site time
            'count'        => count($idx),
            'same_second'  => count($seconds) === 1,
            'via'          => $via,
            'types'        => $types,
            'sample'       => array_slice(array_map(fn($i) => $changes[$i]['title'], $idx), 0, 5),
        ];
    }

    $stmt = $conn->prepare("SELECT COUNT(*) FROM wp_posts WHERE post_type = 'attachment' AND post_date_gmt >= ?");
    $stmt->bind_param('s', $since);
    $stmt->execute();
    $uploads = (int) $stmt->get_result()->fetch_row()[0];

    return ['days' => $days, 'since_gmt' => $since, 'capped' => $capped, 'changes' => $changes, 'batches' => $batches,
        'uploads' => $uploads, 'home' => dw_home_url($conn)];
}
