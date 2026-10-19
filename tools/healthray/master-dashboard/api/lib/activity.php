<?php
/*
 * Unified activity log: one append-only JSON-lines file per site,
 * backups/activity-<site>.jsonl (backups/ is web-blocked + gitignored).
 *
 * md_activity_log($site, $entry) is called by every write endpoint AFTER its
 * commit. Caller keys (all kept as given):
 *   source   content|bulk|redirects|menu|replace|fixer|keywords
 *   action   short verb (field name, 'status', 'save', 'undo', ...)
 *   summary  human sentence
 *   post_ids optional list of ints (derived from changes when omitted)
 *   changes  optional list of
 *              {kind:'post', post_id, field:<wp_posts column>, before, after}
 *              {kind:'meta', post_id, key, before, after}       (before null = row did not exist)
 *              {kind:'redirect', origin, before:{url,type}|null, after:{url,type}|null}
 *              {kind:'link'|'text', ...}                       (display only - undo goes through the journal)
 *   ref      optional {journal:'fixer'|'replace', id, ids?}
 *   undo_of  optional id of the entry an 'undo' entry reverted
 * Added here: id, time (ISO, server clock), ip.
 *
 * An entry is marked undone by appending {"marker":"undone","id":...} rather
 * than rewriting the file; md_activity_read() merges those markers.
 *
 * Logging must never break a write: every failure returns null + error_log().
 * Tests can point the log elsewhere with the MD_ACTIVITY_DIR constant or env var.
 */

const MD_ACTIVITY_SOURCES  = ['content', 'bulk', 'redirects', 'menu', 'replace', 'fixer', 'keywords', 'canonical'];
const MD_ACTIVITY_MAX_SIZE = 20 * 1024 * 1024;

function md_activity_dir(): string
{
    if (defined('MD_ACTIVITY_DIR')) {
        return rtrim((string) constant('MD_ACTIVITY_DIR'), '/\\');
    }
    $env = getenv('MD_ACTIVITY_DIR');
    if (is_string($env) && $env !== '' && PHP_SAPI === 'cli') {
        return rtrim($env, '/\\');
    }
    return __DIR__ . '/../../backups';
}

function md_activity_file(string $site): string
{
    return md_activity_dir() . '/activity-' . (preg_replace('~[^a-z0-9_-]~i', '', $site) ?: 'default') . '.jsonl';
}

/** Append one raw line (already an array) under an exclusive lock, rotating a too-big file first. */
function md_activity_append_line(string $site, array $line): bool
{
    $dir = md_activity_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        error_log('[master-dashboard activity] cannot create ' . $dir);
        return false;
    }
    $guard = $dir . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }
    $json = json_encode($line, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        error_log('[master-dashboard activity] json_encode failed: ' . json_last_error_msg());
        return false;
    }
    $file = md_activity_file($site);
    $fh = @fopen($file, 'ab');
    if (!$fh) {
        error_log('[master-dashboard activity] cannot open ' . $file);
        return false;
    }
    try {
        if (!flock($fh, LOCK_EX)) {
            error_log('[master-dashboard activity] cannot lock ' . $file);
            return false;
        }
        clearstatcache(true, $file);
        if (@filesize($file) > MD_ACTIVITY_MAX_SIZE) {
            // Rotate: keep the old file next to it, start a fresh one.
            flock($fh, LOCK_UN);
            fclose($fh);
            $fh = null;
            $rotated = substr($file, 0, -6) . '-' . date('Ymd-His') . '.jsonl';
            if (!@rename($file, $rotated)) {
                error_log('[master-dashboard activity] rotate failed for ' . $file);
            }
            $fh = @fopen($file, 'ab');
            if (!$fh || !flock($fh, LOCK_EX)) {
                error_log('[master-dashboard activity] cannot reopen ' . $file);
                return false;
            }
        }
        $ok = fwrite($fh, $json . "\n") !== false;
        fflush($fh);
        flock($fh, LOCK_UN);
        return $ok;
    } finally {
        if ($fh) {
            fclose($fh);
        }
    }
}

/**
 * Record one write. Returns the new entry id, or null when it could not be
 * logged (the write itself has already happened - never fail it for this).
 */
function md_activity_log(string $site, array $entry): ?string
{
    try {
        $id = date('Ymd-His') . '-' . bin2hex(random_bytes(4));
        $source = (string) ($entry['source'] ?? '');
        if (!in_array($source, MD_ACTIVITY_SOURCES, true)) {
            $source = $source !== '' ? $source : 'content';
        }
        $changes = isset($entry['changes']) && is_array($entry['changes']) ? array_values($entry['changes']) : [];
        $postIds = isset($entry['post_ids']) && is_array($entry['post_ids'])
            ? $entry['post_ids']
            : array_column(array_filter($changes, 'is_array'), 'post_id');
        $postIds = array_values(array_unique(array_filter(array_map('intval', $postIds), fn($v) => $v > 0)));

        $line = ['id' => $id, 'time' => date('c'), 'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? (PHP_SAPI === 'cli' ? 'cli' : '')), 'site' => $site]
            + $entry
            + ['action' => '', 'summary' => ''];
        $line['source']   = $source;
        $line['post_ids'] = $postIds;
        $line['changes']  = $changes;
        unset($line['marker']);

        return md_activity_append_line($site, $line) ? $id : null;
    } catch (Throwable $e) {
        error_log('[master-dashboard activity] ' . $e->getMessage());
        return null;
    }
}

/** Mark an entry undone (marker line; merged on read). */
function md_activity_mark_undone(string $site, string $id, string $byId, array $extra = []): bool
{
    try {
        return md_activity_append_line($site, ['marker' => 'undone', 'id' => $id, 'by' => $byId, 'time' => date('c')] + $extra);
    } catch (Throwable $e) {
        error_log('[master-dashboard activity] ' . $e->getMessage());
        return false;
    }
}

/** Every activity entry for a site, oldest first, with undone markers merged in. */
function md_activity_read(string $site): array
{
    $file = md_activity_file($site);
    if (!is_file($file)) {
        return [];
    }
    $fh = @fopen($file, 'rb');
    if (!$fh) {
        return [];
    }
    $entries = [];
    $markers = [];
    flock($fh, LOCK_SH);
    while (($line = fgets($fh)) !== false) {
        $e = json_decode($line, true);
        if (!is_array($e) || empty($e['id']) || !is_string($e['id'])) {
            continue;
        }
        if (($e['marker'] ?? '') === 'undone') {
            $markers[$e['id']] = $e;
            continue;
        }
        $entries[$e['id']] = $e;
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    foreach ($markers as $id => $m) {
        if (isset($entries[$id])) {
            $entries[$id]['undone'] = ['time' => $m['time'] ?? '', 'by' => $m['by'] ?? '', 'restored' => $m['restored'] ?? null, 'skipped' => $m['skipped'] ?? null];
        }
    }
    return array_values($entries);
}

/** One entry by id, or null. */
function md_activity_find(string $site, string $id): ?array
{
    foreach (md_activity_read($site) as $e) {
        if ($e['id'] === $id) {
            return $e;
        }
    }
    return null;
}

/** Does the entry match a free-text search (summary, action, post id, keys/origins)? */
function md_activity_matches(array $e, string $q): bool
{
    if ($q === '') {
        return true;
    }
    $q = mb_strtolower($q);
    if (ctype_digit(ltrim($q, '#')) && in_array((int) ltrim($q, '#'), array_map('intval', $e['post_ids'] ?? []), true)) {
        return true;
    }
    $hay = [(string) ($e['summary'] ?? ''), (string) ($e['action'] ?? ''), implode(' ', $e['post_ids'] ?? [])];
    foreach (($e['changes'] ?? []) as $c) {
        if (!is_array($c)) {
            continue;
        }
        foreach (['field', 'key', 'origin', 'title'] as $k) {
            if (isset($c[$k]) && is_scalar($c[$k])) {
                $hay[] = (string) $c[$k];
            }
        }
    }
    return str_contains(mb_strtolower(implode(' ', $hay)), $q);
}

/**
 * Filtered, newest-first page of the log.
 * $filters: source (one of MD_ACTIVITY_SOURCES or ''), q (search text).
 * $extra:   more entries in the same shape (e.g. the Link Fixer / Find &
 *           Replace journals mapped by activity_list.php) merged in before
 *           sorting/filtering.
 * Returns {entries, total, counts_by_source, recent_24h, all_total}.
 */
function md_activity_list(string $site, array $filters = [], int $limit = 200, int $offset = 0, array $extra = []): array
{
    $all = array_merge(md_activity_read($site), $extra);
    foreach ($all as $i => $e) {
        $all[$i]['_ts'] = strtotime((string) ($e['time'] ?? '')) ?: 0;
    }
    usort($all, fn($a, $b) => [$b['_ts'], $b['id']] <=> [$a['_ts'], $a['id']]);

    $source = (string) ($filters['source'] ?? '');
    $q      = trim((string) ($filters['q'] ?? ''));
    $dayAgo = time() - 86400;

    $counts = array_fill_keys(MD_ACTIVITY_SOURCES, 0);
    $recent = 0;
    $matched = [];
    foreach ($all as $e) {
        if ($e['_ts'] >= $dayAgo && ($e['action'] ?? '') !== 'undo') {
            $recent++;
        }
        if (!md_activity_matches($e, $q)) {
            continue;
        }
        $s = (string) ($e['source'] ?? '');
        $counts[$s] = ($counts[$s] ?? 0) + 1;
        if ($source !== '' && $s !== $source) {
            continue;
        }
        unset($e['_ts']);
        $matched[] = $e;
    }

    return [
        'entries'          => array_slice($matched, max(0, $offset), max(1, $limit)),
        'total'            => count($matched),
        'counts_by_source' => $counts,
        'recent_24h'       => $recent,
        'all_total'        => count($all),
    ];
}

/** Short display form of a value for summaries. */
function md_activity_short($v, int $n = 60): string
{
    $s = trim(preg_replace('/\s+/', ' ', (string) $v));
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
}
