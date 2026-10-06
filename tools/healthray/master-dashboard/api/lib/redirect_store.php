<?php

/*
 * ── Yoast SEO Premium redirect store: read + safe write ──────────────────
 *
 * Yoast Premium keeps its redirects in wp_options, spread over THREE options
 * that must stay consistent with each other:
 *
 *   wpseo-premium-redirects-base           (autoload off)
 *       The canonical list the wp-admin "Redirects" screen reads and edits.
 *       On this install it is an *indexed list* of
 *       ['origin' => .., 'url' => .., 'type' => int, 'format' => 'plain'|'regex'],
 *       holding plain and regex rules together.
 *
 *   wpseo-premium-redirects-export-plain   (autoload ON)
 *       A *map* of origin => ['url' => .., 'type' => int] containing only the
 *       plain rules. This is the lookup table the front-end redirect handler
 *       actually consults on every request.
 *
 *   wpseo-premium-redirects-export-regex   (autoload ON)
 *       The same idea for regex rules. Read here only so a new plain rule can
 *       be warned about when an existing pattern already covers it.
 *
 * Writing only "base" produces a redirect that shows up in wp-admin but never
 * fires; writing only "export-plain" produces one that fires but is invisible
 * (and gets clobbered the next time someone saves in wp-admin). So every write
 * in this file updates base *and* export-plain inside one transaction.
 *
 * Stored shape: origins/targets are site-relative paths with no leading or
 * trailing slash ("blog/ehr/some-post"); a 410 has an empty destination.
 */

const DW_OPT_REDIRECT_BASE  = 'wpseo-premium-redirects-base';
const DW_OPT_REDIRECT_PLAIN = 'wpseo-premium-redirects-export-plain';
const DW_OPT_REDIRECT_REGEX = 'wpseo-premium-redirects-export-regex';

/** Redirect types Yoast supports. "Gone" types carry no destination. */
function dw_redirect_types()
{
    return [301, 302, 307, 410, 451];
}

/** True for types that intentionally have no destination URL. */
function dw_redirect_type_is_gone($type)
{
    return in_array((int) $type, [410, 451], true);
}

/**
 * Reduce a user-supplied origin/destination to the exact shape Yoast stores.
 *
 * Absolute URLs on this site are collapsed to their path; absolute URLs on
 * another host are passed through untouched (only ever meaningful as a 301
 * destination). Query strings are preserved but never slash-trimmed - Yoast
 * matches a plain origin against the full request URI, so "foo?x=1" and
 * "foo" are genuinely different rules.
 *
 * @return array{value:string, external:bool}
 */
function dw_redirect_normalize($value, $home)
{
    $value = trim((string) $value);
    if ($value === '') {
        return ['value' => '', 'external' => false];
    }

    $homeHost = preg_replace('~^www\.~i', '', (string) parse_url((string) $home, PHP_URL_HOST));

    if (preg_match('~^[a-z][a-z0-9+.-]*://~i', $value)) {
        $host = preg_replace('~^www\.~i', '', (string) parse_url($value, PHP_URL_HOST));
        $sameSite = $host !== '' && $homeHost !== '' && strcasecmp($host, $homeHost) === 0;
        if (!$sameSite) {
            return ['value' => $value, 'external' => true];
        }
        $parts = parse_url($value);
        $value = (string) ($parts['path'] ?? '');
        if (isset($parts['query']) && $parts['query'] !== '') {
            $value .= '?' . $parts['query'];
        }
    }

    /*
     * Protocol-relative ("//host/path") is an absolute URL, not a path. Tested
     * as exactly two slashes followed by a host character so a path that merely
     * arrived with duplicate slashes ("///blog//x") is still treated as local
     * and gets collapsed below.
     */
    if (preg_match('~^//[^/]~', $value)) {
        return ['value' => $value, 'external' => true];
    }

    $query = '';
    $qPos  = strpos($value, '?');
    if ($qPos !== false) {
        $query = substr($value, $qPos);
        $value = substr($value, 0, $qPos);
    }

    $value = preg_replace('~/+~', '/', $value);
    $value = trim((string) $value, '/');

    return ['value' => $value . $query, 'external' => false];
}

/**
 * Dedupe key for an origin. Yoast's own matching is case-sensitive, but two
 * rules differing only in case are a duplicate in every practical sense, so
 * detection is deliberately case-insensitive.
 */
function dw_redirect_key($origin)
{
    return strtolower(trim((string) $origin, '/'));
}

/** Unserialize one option value into an array, tolerating empty/corrupt data. */
function dw_redirect_unserialize($raw)
{
    if ($raw === null || $raw === '') {
        return [];
    }
    $data = @unserialize((string) $raw, ['allowed_classes' => false]);
    return is_array($data) ? $data : [];
}

/**
 * Normalize whatever "base" holds into a uniform rule set, remembering which
 * shape it came in as so it can be written back the same way.
 *
 * Yoast has shipped both layouts over the years: an indexed list of rules
 * that each name their own origin, and a map of origin => rule. Guessing
 * wrong on write would make the wp-admin screen unreadable, so the shape is
 * detected rather than assumed.
 *
 * The array keys are preserved exactly. On a real install the list is
 * *sparse* - Yoast removes a rule with unset() and never reindexes - so
 * renumbering it would rewrite every entry after the first gap and shift
 * rules the caller never touched.
 *
 * @return array{rules:array, shape:string}
 */
function dw_redirect_normalize_base(array $data)
{
    $rules = [];
    $shape = 'list';

    foreach ($data as $key => $entry) {
        if (!is_array($entry)) {
            continue;
        }
        if (array_key_exists('origin', $entry)) {
            $origin = (string) $entry['origin'];
        } else {
            // Map layout: the array key is the origin.
            $origin = (string) $key;
            $shape  = 'map';
        }
        if ($origin === '') {
            continue;
        }
        $format = (string) ($entry['format'] ?? 'plain');
        $rules[$key] = [
            'origin' => $origin,
            'url'    => (string) ($entry['url'] ?? ''),
            'type'   => (int) ($entry['type'] ?? 301),
            'format' => $format === 'regex' ? 'regex' : 'plain',
        ];
    }

    return ['rules' => $rules, 'shape' => $shape];
}

/**
 * The array key a newly added rule should take, continuing the existing
 * numbering instead of reusing a gap left by a deleted rule.
 */
function dw_redirect_next_index(array $rules)
{
    $intKeys = array_filter(array_keys($rules), 'is_int');
    return $intKeys ? max($intKeys) + 1 : 0;
}

/** Serialize the uniform rule set back into whichever layout "base" used. */
function dw_redirect_serialize_base(array $rules, $shape)
{
    if ($shape === 'map') {
        $out = [];
        foreach ($rules as $r) {
            $out[$r['origin']] = ['url' => $r['url'], 'type' => (int) $r['type'], 'format' => $r['format']];
        }
        return serialize($out);
    }

    // Keys preserved verbatim, gaps included - see dw_redirect_normalize_base().
    $out = [];
    foreach ($rules as $key => $r) {
        $out[$key] = ['origin' => $r['origin'], 'url' => $r['url'], 'type' => (int) $r['type'], 'format' => $r['format']];
    }
    return serialize($out);
}

/** Build the autoloaded runtime lookup map (origin => [url, type]) for one format. */
function dw_redirect_serialize_export(array $rules, $format)
{
    $out = [];
    foreach ($rules as $r) {
        if ($r['format'] !== $format) {
            continue;
        }
        $out[$r['origin']] = ['url' => $r['url'], 'type' => (int) $r['type']];
    }
    return serialize($out);
}

/**
 * Read all three redirect options, with their row ids/autoload flags so a
 * write can update in place (and recreate a missing row with a sane autoload).
 *
 * @param bool $forUpdate Lock the rows for the remainder of the transaction.
 */
function dw_redirect_read_options(mysqli $conn, $forUpdate = false)
{
    $names = [DW_OPT_REDIRECT_BASE, DW_OPT_REDIRECT_PLAIN, DW_OPT_REDIRECT_REGEX];
    $ph    = implode(',', array_fill(0, count($names), '?'));
    $sql   = "SELECT option_id, option_name, option_value, autoload FROM wp_options WHERE option_name IN ($ph)";
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }
    $stmt = $conn->prepare($sql);
    $stmt->bind_param(str_repeat('s', count($names)), ...$names);
    $stmt->execute();
    $res = $stmt->get_result();

    $rows = [];
    while ($row = $res->fetch_assoc()) {
        $rows[$row['option_name']] = $row;
    }
    $stmt->close();

    return $rows;
}

/**
 * Every configured redirect, plus fast lookup indexes.
 *
 * "base" is treated as the source of truth because it is the only option that
 * records each rule's format; the export maps are derived from it on write.
 *
 * @return array{
 *   rules:array, shape:string, plain:array, regex:array,
 *   by_key:array, options:array
 * }
 */
function dw_redirect_load(mysqli $conn, $forUpdate = false)
{
    $options = dw_redirect_read_options($conn, $forUpdate);

    $base = dw_redirect_normalize_base(
        dw_redirect_unserialize($options[DW_OPT_REDIRECT_BASE]['option_value'] ?? '')
    );

    /*
     * Fall back to the autoloaded export maps if "base" is empty or missing -
     * on a site where only those exist, they still describe every live rule
     * and are better than reporting "no redirects configured".
     */
    if (!$base['rules']) {
        $rules = [];
        foreach (['plain' => DW_OPT_REDIRECT_PLAIN, 'regex' => DW_OPT_REDIRECT_REGEX] as $format => $optName) {
            foreach (dw_redirect_unserialize($options[$optName]['option_value'] ?? '') as $origin => $entry) {
                if (!is_array($entry) || (string) $origin === '') {
                    continue;
                }
                $rules[] = [
                    'origin' => (string) $origin,
                    'url'    => (string) ($entry['url'] ?? ''),
                    'type'   => (int) ($entry['type'] ?? 301),
                    'format' => $format,
                ];
            }
        }
        $base['rules'] = $rules;
    }

    $byKey = [];
    foreach ($base['rules'] as $i => $r) {
        if ($r['format'] === 'plain') {
            // First rule wins, mirroring Yoast's own first-match behaviour.
            $byKey[dw_redirect_key($r['origin'])] ??= $i;
        }
    }

    return [
        'rules'   => $base['rules'],
        'shape'   => $base['shape'],
        'by_key'  => $byKey,
        'options' => $options,
    ];
}

/**
 * The plain rule configured for a site-relative path, or null.
 * Accepts any of "path", "/path/", or a full URL on this site.
 */
function dw_redirect_find(array $store, $origin, $home = '')
{
    $norm = $home !== '' ? dw_redirect_normalize($origin, $home)['value'] : $origin;
    $idx  = $store['by_key'][dw_redirect_key($norm)] ?? null;
    return $idx === null ? null : $store['rules'][$idx] + ['index' => $idx];
}

/**
 * Existing regex rules whose pattern already covers this path.
 *
 * Purely advisory: it explains why a path might already be redirecting before
 * a plain rule is added. Yoast stores these patterns with a leading "^/", so
 * the path is tested with a leading slash. Invalid patterns are skipped.
 */
function dw_redirect_matching_regexes(array $store, $path)
{
    $subject = '/' . ltrim((string) $path, '/');
    $hits    = [];

    foreach ($store['rules'] as $r) {
        if ($r['format'] !== 'regex' || $r['origin'] === '') {
            continue;
        }
        $matched = false;
        set_error_handler(fn() => true);
        try {
            $matched = @preg_match('~' . str_replace('~', '\~', $r['origin']) . '~', $subject) === 1;
        } catch (\Throwable $e) {
            $matched = false;
        } finally {
            restore_error_handler();
        }
        if ($matched) {
            $hits[] = $r;
        }
    }
    return $hits;
}

/**
 * Snapshot the current option values to a local JSON file before any write.
 *
 * Deliberately a file on this tool's own disk rather than extra wp_options
 * rows: restoring is a copy/paste, and nothing is added to the live site's
 * options table.
 *
 * @return string Backup file path, or '' when it could not be written.
 */
function dw_redirect_backup(array $options, $dbKey = '')
{
    $dir = __DIR__ . '/../../backups';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        return '';
    }

    // Backups contain live site data - keep them out of the web root's reach.
    $guard = $dir . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }

    $payload = [
        'taken_at' => date('c'),
        'database' => $dbKey,
        'options'  => [],
    ];
    foreach ($options as $name => $row) {
        $payload['options'][$name] = [
            'option_id'    => $row['option_id'] ?? null,
            'autoload'     => $row['autoload'] ?? null,
            'option_value' => $row['option_value'] ?? '',
        ];
    }

    $file = sprintf('%s/redirects-%s%s.json', $dir, (new DateTime())->format('Ymd-His-u'), $dbKey !== '' ? '-' . preg_replace('~[^a-z0-9_-]~i', '', $dbKey) : '');
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return @file_put_contents($file, $json) === false ? '' : $file;
}

/** Write one option value, creating the row if it doesn't exist yet. */
function dw_redirect_write_option(mysqli $conn, array $options, $name, $value, $autoloadForNew)
{
    if (isset($options[$name]['option_id'])) {
        $stmt = $conn->prepare('UPDATE wp_options SET option_value = ? WHERE option_id = ?');
        $stmt->bind_param('si', $value, $options[$name]['option_id']);
        $stmt->execute();
        $stmt->close();
        return;
    }

    $stmt = $conn->prepare('INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $name, $value, $autoloadForNew);
    $stmt->execute();
    $stmt->close();
}

/**
 * Persist a rule list: "base" plus both derived runtime export maps, in one
 * transaction, so the admin screen and the redirect handler can never
 * disagree about what is configured.
 */
function dw_redirect_persist(mysqli $conn, array $store, array $rules)
{
    $options = $store['options'];

    dw_redirect_write_option($conn, $options, DW_OPT_REDIRECT_BASE, dw_redirect_serialize_base($rules, $store['shape']), 'off');
    dw_redirect_write_option($conn, $options, DW_OPT_REDIRECT_PLAIN, dw_redirect_serialize_export($rules, 'plain'), 'on');
    dw_redirect_write_option($conn, $options, DW_OPT_REDIRECT_REGEX, dw_redirect_serialize_export($rules, 'regex'), 'on');
}

/**
 * Validate a requested redirect against the current store.
 *
 * Separated from the write so the UI can preview exactly what would happen -
 * including the duplicate it would replace - before anything is saved.
 *
 * @return array{
 *   ok:bool, error:string, origin:string, target:string, type:int,
 *   existing:?array, warnings:array<string>
 * }
 */
function dw_redirect_validate(array $store, $origin, $type, $target, $home)
{
    $type = (int) $type;
    $out  = ['ok' => false, 'error' => '', 'origin' => '', 'target' => '', 'type' => $type, 'existing' => null, 'warnings' => []];

    if (!in_array($type, dw_redirect_types(), true)) {
        $out['error'] = 'Unsupported redirect type ' . $type . '.';
        return $out;
    }

    $originNorm = dw_redirect_normalize($origin, $home);
    if ($originNorm['external']) {
        $out['error'] = 'The origin must be a URL on this site.';
        return $out;
    }
    if ($originNorm['value'] === '') {
        $out['error'] = 'The origin URL is required.';
        return $out;
    }
    $out['origin'] = $originNorm['value'];

    if (dw_redirect_type_is_gone($type)) {
        // A "Gone" rule has no destination by definition - drop anything sent.
        $out['target'] = '';
    } else {
        $targetNorm = dw_redirect_normalize($target, $home);
        if ($targetNorm['value'] === '') {
            $out['error'] = 'A ' . $type . ' redirect needs a destination URL.';
            return $out;
        }
        $out['target'] = $targetNorm['value'];

        if (!$targetNorm['external'] && dw_redirect_key($out['origin']) === dw_redirect_key($out['target'])) {
            $out['error'] = 'The origin and destination are the same URL - that would be a redirect loop.';
            return $out;
        }

        /*
         * Yoast does not follow chains: if the destination is itself an origin,
         * visitors get a second redirect (or a 410). Worth flagging, but the
         * user may genuinely want it, so it doesn't block the save.
         */
        if (!$targetNorm['external']) {
            $chain = $store['by_key'][dw_redirect_key($out['target'])] ?? null;
            if ($chain !== null) {
                $chained = $store['rules'][$chain];
                $out['warnings'][] = $chained['type'] === 410
                    ? 'The destination "/' . $chained['origin'] . '/" already has a 410 Gone rule, so this redirect would land on a dead URL.'
                    : 'The destination "/' . $chained['origin'] . '/" is itself redirected to "/' . $chained['url'] . '/" - Yoast will not follow the chain.';
            }
        }
    }

    $existing = dw_redirect_find($store, $out['origin']);
    if ($existing) {
        $out['existing'] = $existing;
    }

    foreach (dw_redirect_matching_regexes($store, $out['origin']) as $rx) {
        $out['warnings'][] = 'An existing regex rule already matches this URL: ' . $rx['origin'] . ' (' . $rx['type'] . ').';
    }

    $out['ok'] = true;
    return $out;
}

/**
 * Create or update one plain redirect.
 *
 * Refuses to create a second rule for an origin that already has one - the
 * caller must pass $replace to overwrite it, so "add a redirect" can never
 * silently produce duplicates.
 *
 * @return array{status:string, ...} status: created | updated | duplicate | unchanged | error
 */
function dw_redirect_upsert(mysqli $conn, $origin, $type, $target, $replace = false, $dbKey = '', $home = null)
{
    $home = $home ?? dw_home_url($conn);

    $conn->begin_transaction();
    try {
        // Locked read: validating and writing against one consistent snapshot
        // keeps two concurrent saves from clobbering each other's rule.
        $store = dw_redirect_load($conn, true);
        $check = dw_redirect_validate($store, $origin, $type, $target, $home);

        if (!$check['ok']) {
            $conn->rollback();
            return ['status' => 'error', 'msg' => $check['error']];
        }

        $rules    = $store['rules'];
        $existing = $check['existing'];

        if ($existing) {
            $sameType   = (int) $existing['type'] === (int) $check['type'];
            $sameTarget = dw_redirect_key($existing['url']) === dw_redirect_key($check['target']);

            if ($sameType && $sameTarget) {
                $conn->rollback();
                return [
                    'status'   => 'unchanged',
                    'msg'      => 'That redirect already exists - nothing to change.',
                    'origin'   => $check['origin'],
                    'type'     => (int) $check['type'],
                    'target'   => $check['target'],
                    'existing' => $existing,
                    'warnings' => $check['warnings'],
                ];
            }

            if (!$replace) {
                $conn->rollback();
                return [
                    'status'   => 'duplicate',
                    'msg'      => 'A redirect for this URL already exists.',
                    'origin'   => $check['origin'],
                    'existing' => $existing,
                    'warnings' => $check['warnings'],
                ];
            }

            $rules[$existing['index']] = [
                'origin' => $existing['origin'], // keep the stored spelling
                'url'    => $check['target'],
                'type'   => (int) $check['type'],
                'format' => 'plain',
            ];
            $result = 'updated';
        } else {
            $rules[dw_redirect_next_index($rules)] = [
                'origin' => $check['origin'],
                'url'    => $check['target'],
                'type'   => (int) $check['type'],
                'format' => 'plain',
            ];
            $result = 'created';
        }

        $backup = dw_redirect_backup($store['options'], $dbKey);
        dw_redirect_persist($conn, $store, $rules);
        $conn->commit();

        return [
            'status'      => $result,
            'msg'         => $result === 'created' ? 'Redirect added.' : 'Redirect updated.',
            'origin'      => $check['origin'],
            'type'        => (int) $check['type'],
            'target'      => $check['target'],
            'previous'    => $existing,
            'warnings'    => $check['warnings'],
            'backup_file' => $backup !== '' ? basename($backup) : '',
            'total_rules' => count($rules),
        ];
    } catch (\Throwable $e) {
        $conn->rollback();
        return ['status' => 'error', 'msg' => 'Redirect not saved: ' . $e->getMessage()];
    }
}

/** Delete the plain redirect configured for one origin. */
function dw_redirect_delete(mysqli $conn, $origin, $dbKey = '', $home = null)
{
    $home = $home ?? dw_home_url($conn);

    $conn->begin_transaction();
    try {
        $store    = dw_redirect_load($conn, true);
        $norm     = dw_redirect_normalize($origin, $home);
        $existing = dw_redirect_find($store, $norm['value']);

        if (!$existing) {
            $conn->rollback();
            return ['status' => 'missing', 'msg' => 'No redirect is configured for that URL.'];
        }

        // Left sparse on purpose - that is exactly what Yoast's own delete does.
        $rules = $store['rules'];
        unset($rules[$existing['index']]);

        $backup = dw_redirect_backup($store['options'], $dbKey);
        dw_redirect_persist($conn, $store, $rules);
        $conn->commit();

        return [
            'status'      => 'deleted',
            'msg'         => 'Redirect removed.',
            'origin'      => $existing['origin'],
            'removed'     => $existing,
            'backup_file' => $backup !== '' ? basename($backup) : '',
            'total_rules' => count($rules),
        ];
    } catch (\Throwable $e) {
        $conn->rollback();
        return ['status' => 'error', 'msg' => 'Redirect not removed: ' . $e->getMessage()];
    }
}

