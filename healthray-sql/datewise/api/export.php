<?php
require __DIR__ . '/bootstrap.php';

// CSV only - this tool intentionally doesn't offer Excel/JSON export.
$format = 'csv';

$knownPostTypes = dw_known_post_types($conn);
$f = dw_parse_input($_GET, $knownPostTypes);

/* Every column this tool can export - post_type and link_status are display-only and never appear here. */
$allColumns = [
    ['id', 'ID'],
    ['title', 'Title'],
    ['slug', 'Slug'],
    ['permalink', 'Permalink'],
    ['status', 'Status'],
    ['category', 'Category'],
    ['meta_title', 'Meta Title'],
    ['meta_description', 'Meta Description'],
    ['publish_date', 'Publish Date'],
];

/* Narrow to whichever columns the UI's column picker (or caller) selected. */
$requestedKeys = array_filter(array_map('trim', explode(',', (string) ($_GET['columns'] ?? ''))));
$columns = $requestedKeys
    ? array_values(array_filter($allColumns, fn($c) => in_array($c[0], $requestedKeys, true)))
    : [];
if (!$columns) {
    $columns = $allColumns;
}

/** Pull one hydrated row into the ordered cell list above. */
function dw_flatten_row(array $row, array $columns)
{
    $cells = [];
    foreach ($columns as [$key]) {
        $cells[] = $row[$key] ?? '';
    }
    return $cells;
}

/*
 * Optional live link-status filter: "200,301" (etc) keeps only rows whose
 * permalink currently returns one of those codes; "other" keeps anything
 * outside the known set (200/301/302/404/410). This checks every matching
 * post's URL for real during export, so it's opt-in and much slower than
 * the plain DB-only export - the caller explicitly asked for accuracy over
 * speed here.
 */
$wantedCodes  = array_values(array_filter(array_map('trim', explode(',', (string) ($_GET['link_status'] ?? '')))));
$wantOther    = in_array('other', $wantedCodes, true);
$wantedCodes  = array_values(array_diff($wantedCodes, ['other']));
$linkStatusOn = (bool) $wantedCodes || $wantOther;

if ($linkStatusOn) {
    require __DIR__ . '/lib/link_checker.php';
    set_time_limit(0); // a full live-checked export can legitimately take minutes
}

const DW_BATCH = 200;

/** Fetch+hydrate the next DB batch, live-check it if a link-status filter is active, return [rows, isLastBatch]. */
function dw_next_export_batch(mysqli $conn, array $f, $offset, $linkStatusOn, array $wantedCodes, $wantOther)
{
    $raw = dw_fetch_posts_page($conn, $f, DW_BATCH, $offset);
    if (!$raw) {
        return [[], true];
    }
    $rows = dw_hydrate_batch($conn, $raw);

    if ($linkStatusOn) {
        $statusByUrl = dw_check_urls_concurrent(array_column($rows, 'permalink'));
        $rows = array_values(array_filter($rows, function ($row) use ($statusByUrl, $wantedCodes, $wantOther) {
            $code = $statusByUrl[$row['permalink']] ?? 0;
            return dw_link_status_matches($code, $wantedCodes, $wantOther);
        }));
    }

    return [$rows, count($raw) < DW_BATCH];
}

$stamp    = date('Y-m-d_His');
$filename = "content-export-{$stamp}.{$format}";

header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"{$filename}\"");

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel doesn't mangle non-ASCII text
fputcsv($out, array_column($columns, 1));

$offset = 0;
while (true) {
    [$rows, $isLast] = dw_next_export_batch($conn, $f, $offset, $linkStatusOn, $wantedCodes, $wantOther);
    foreach ($rows as $row) {
        fputcsv($out, dw_flatten_row($row, $columns));
    }
    if ($isLast) {
        break;
    }
    $offset += DW_BATCH;
}
fclose($out);
