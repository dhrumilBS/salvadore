<?php
/*
 * Usage log: who opened which tool, when, and for how long.
 *
 * The log lives OUTSIDE htdocs (D:\xampp\salvadore-usage\ by default) so no
 * web request can read, edit or delete it. collect.php is the only writer and
 * can only append. Each line is signed with an HMAC of the previous line's
 * signature, so editing, reordering or deleting any line breaks the chain and
 * the report shows the log as tampered. backup.php copies the log off this PC
 * every hour and records the newest signature ("anchor"), so cutting entries
 * off the end of the log is caught too.
 *
 * Files in the log folder:
 *   YYYY-MM.log     one JSON entry per line (month in UTC)
 *   .key            the HMAC key, created on first write - never share it
 *   labels.json     names you gave to people in the report (not part of the signed log)
 *   backup-dir.txt  where backup.php copies the log (one line: a folder path)
 *   backup.log      what each backup run did
 */

// Events the browser may send. 'past' = a page view imported from Apache's access.log.
const USAGE_EVENTS = ['start', 'beat', 'nav', 'end'];
const USAGE_RATE_PER_MINUTE = 300;          // per IP; a busy person clicking around sends ~160
const USAGE_MAX_MONTH_BYTES = 100 * 1024 * 1024;

function usage_dir(): string
{
    $dir = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'salvadore-usage';
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    return $dir;
}

function usage_key(): string
{
    static $key = null;
    $file = usage_dir() . '/.key';
    if (!is_file($file)) {
        file_put_contents($file, bin2hex(random_bytes(32)), LOCK_EX);
    }
    return $key ??= trim((string) file_get_contents($file));
}

/** Log files, oldest first. */
function usage_files(): array
{
    $files = glob(usage_dir() . '/[0-9][0-9][0-9][0-9]-[0-9][0-9].log') ?: [];
    sort($files);
    return $files;
}

/** Splits a stored line into [signed body, signature], or null if malformed. */
function usage_split(string $line): ?array
{
    return preg_match('/^(\{.*),"h":"([0-9a-f]{64})"\}$/', $line, $m) ? [$m[1] . '}', $m[2]] : null;
}

function usage_sign(string $prev, string $body): string
{
    return hash_hmac('sha256', $prev . "\n" . $body, usage_key());
}

/** Signature of the newest line in the log, or 'genesis' for an empty log. */
function usage_last_hash(): string
{
    $files = usage_files();
    $file = end($files);
    if (!$file || !filesize($file)) {
        return 'genesis';
    }
    $fh = fopen($file, 'rb');
    fseek($fh, -min(8192, filesize($file)), SEEK_END);
    $lines = preg_split('/\n/', trim(stream_get_contents($fh)));
    fclose($fh);
    $last = usage_split((string) end($lines));
    return $last ? $last[1] : 'broken';
}

/** Runs $fn while holding the log's write lock. */
function usage_locked(callable $fn)
{
    $lock = fopen(usage_dir() . '/.lock', 'c');
    flock($lock, LOCK_EX);
    try {
        return $fn();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** Appends entries in order, each chained to the line before it. */
function usage_append(array ...$entries): void
{
    usage_locked(function () use ($entries) {
        $prev = usage_last_hash();
        $out = '';
        foreach ($entries as $entry) {
            $body = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            $prev = usage_sign($prev, $body);
            $out .= substr($body, 0, -1) . ',"h":"' . $prev . '"}' . "\n";
        }
        file_put_contents(usage_dir() . '/' . gmdate('Y-m') . '.log', $out, FILE_APPEND);
    });
}

/** True while $ip stays under USAGE_RATE_PER_MINUTE events in the current minute. */
function usage_rate_ok(string $ip): bool
{
    $fh = fopen(usage_dir() . '/.rate.json', 'c+');
    flock($fh, LOCK_EX);
    $minute = intdiv(time(), 60);
    $rates = array_filter(json_decode((string) stream_get_contents($fh), true) ?: [], fn($r) => $r[0] === $minute);
    $rates[$ip] = [$minute, ($rates[$ip][1] ?? 0) + 1];
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($rates));
    flock($fh, LOCK_UN);
    fclose($fh);
    return $rates[$ip][1] <= USAGE_RATE_PER_MINUTE;
}

/** Folder backup.php copies to (from backup-dir.txt), or null if not set. */
function usage_backup_dir(): ?string
{
    $dir = trim((string) @file_get_contents(usage_dir() . '/backup-dir.txt'));
    return $dir !== '' ? $dir : null;
}

/** Newest anchor backup.php recorded: ['t', 'entries', 'hash'], or null. */
function usage_last_anchor(): ?array
{
    $dir = usage_backup_dir();
    $lines = $dir ? @file($dir . '/anchors.log', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : false;
    return $lines ? json_decode(end($lines), true) : null;
}

/** Where a read starts: the beginning of the log. */
const USAGE_START = ['file' => '', 'offset' => 0, 'h' => 'genesis'];

/**
 * Reads the log from a cursor (['file', 'offset', 'h' = signature of the line
 * just before it]), checking every signature on the way. Calls $each(entry,
 * signature) per entry. Returns the first bad line (or null) and the cursor
 * to continue from - the live report polls with it to get only new lines.
 * A line still being written is left for the next read.
 */
function usage_scan(array $from, callable $each): array
{
    $prev = $from['h'];
    $cursor = $from;
    $broken = null;
    if ($from['file'] !== '' && !is_file(usage_dir() . '/' . $from['file'])) {
        return ['broken' => ['file' => $from['file'], 'line' => 0], 'cursor' => $from];
    }
    foreach (usage_files() as $file) {
        $name = basename($file);
        if ($name < $from['file']) {
            continue;
        }
        $offset = $name === $from['file'] ? $from['offset'] : 0;
        if ($offset > filesize($file)) {
            return ['broken' => ['file' => $name, 'line' => 0], 'cursor' => $from];
        }
        $fh = fopen($file, 'rb');
        fseek($fh, $offset);
        $n = 0;
        while (($line = fgets($fh)) !== false && str_ends_with($line, "\n")) {
            $n++;
            $offset += strlen($line);
            $line = rtrim($line, "\r\n");
            if ($line === '') {
                continue;
            }
            $parts = usage_split($line);
            $entry = $parts ? json_decode($parts[0], true) : null;
            if (!$broken && (!$entry || !hash_equals(usage_sign($prev, $parts[0]), $parts[1]))) {
                $broken = ['file' => $name, 'line' => $n];
            }
            if ($parts) {
                $prev = $parts[1];
            }
            if ($entry) {
                $each($entry, $prev);
            }
        }
        fclose($fh);
        $cursor = ['file' => $name, 'offset' => $offset, 'h' => $prev];
    }
    return ['broken' => $broken, 'cursor' => $cursor];
}

/**
 * Reads the whole log, checking every signature and that the log still
 * contains the last backed-up anchor. Calls $each(entry) for every entry
 * with t >= $since. Returns the integrity result and the cursor at the end.
 */
function usage_read(int $since, callable $each): array
{
    $anchor = usage_last_anchor();
    $count = 0;
    $first = null;
    $anchorOk = null;
    $scan = usage_scan(USAGE_START, function (array $entry, string $h) use ($since, $each, $anchor, &$count, &$first, &$anchorOk) {
        $count++;
        if ($anchor && $count === $anchor['entries']) {
            $anchorOk = hash_equals($anchor['hash'], $h);
        }
        if ($entry['ev'] !== 'past') {
            $first ??= $entry['t'];
        }
        if ($entry['t'] >= $since) {
            $each($entry);
        }
    });
    $broken = $scan['broken'];
    // Fewer entries than the backup saw = lines were cut off the end.
    if ($anchor && $anchorOk === null) {
        $anchorOk = false;
    }
    return [
        'ok'      => !$broken && $anchorOk !== false,
        'broken'  => $broken,
        'entries' => $count,
        'since'   => $first,
        'backup'  => $anchor ? ['t' => $anchor['t'], 'entries' => $anchor['entries'], 'matches' => $anchorOk] : null,
        'cursor'  => $scan['cursor'],
    ];
}

/**
 * Tool name for a page path, from the dashboard registry. A page belongs to a
 * tool if it sits directly in its folder (so tools/healthray/datewise/ isn't
 * the File Browser); anything else is shown as its folder.
 */
function usage_tool_for(string $path): string
{
    static $tools = null;
    if ($tools === null) {
        $tools = ['/salvadore/' => 'Dashboard'];
        foreach (require dirname(__DIR__) . '/registry.php' as $g) {
            foreach ($g['items'] as $it) {
                $tools['/salvadore/' . strtok($it['path'], '#')] = $it['name'];
            }
        }
    }
    $dir = preg_replace('#[^/]*$#', '', $path);
    return $tools[$dir] ?? (trim(preg_replace('#^/salvadore/(tools/)?#', '', $dir), '/') ?: $path);
}

/**
 * Only this PC: localhost, or this PC opening its own LAN address. Anything
 * that came through a proxy/tunnel is refused, since a tunnel running on this
 * PC would make outside visitors look like localhost.
 */
function usage_is_this_pc(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $local = in_array($ip, ['127.0.0.1', '::1'], true) || $ip === ($_SERVER['SERVER_ADDR'] ?? null);
    $proxied = !empty($_SERVER['HTTP_X_FORWARDED_FOR']) || !empty($_SERVER['HTTP_CF_CONNECTING_IP']) || !empty($_SERVER['HTTP_FORWARDED']);
    return $local && !$proxied;
}

function usage_require_this_pc(): void
{
    if (!usage_is_this_pc()) {
        http_response_code(403);
        exit('Forbidden');
    }
}

/** For scripts meant to be run from the command line / Task Scheduler only. */
function usage_require_cli(): void
{
    if (PHP_SAPI !== 'cli') {
        http_response_code(403);
        exit('Forbidden');
    }
}
