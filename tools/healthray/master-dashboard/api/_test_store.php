<?php
// Command line only - it prints site data and must never be reachable over the web.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
/*
 * TEMPORARY read-only test for lib/redirect_store.php.
 * Nothing here writes to the database — it asserts that what the library
 * would serialize is byte-identical to what is currently stored, so a write
 * can only ever change the one rule being added.
 */
require __DIR__ . '/../../conn.php';
require __DIR__ . '/lib/constants.php';
require __DIR__ . '/lib/query.php';
require __DIR__ . '/lib/redirect_store.php';
$conn->set_charset('utf8mb4');

$home  = dw_home_url($conn);
$store = dw_redirect_load($conn);

echo "home            : $home\n";
echo "base shape      : {$store['shape']}\n";
echo "rules parsed    : " . count($store['rules']) . "\n";
$byFormat = [];
$byType   = [];
foreach ($store['rules'] as $r) {
    $byFormat[$r['format']] = ($byFormat[$r['format']] ?? 0) + 1;
    $byType[$r['type']]     = ($byType[$r['type']] ?? 0) + 1;
}
echo "by format       : " . json_encode($byFormat) . "\n";
echo "by type         : " . json_encode($byType) . "\n";
echo "plain index size: " . count($store['by_key']) . "\n\n";

/* ── Round-trip fidelity: re-serializing untouched rules must reproduce the
      exact bytes already in wp_options, for all three options. ── */
echo "--- round-trip fidelity (no rule changed) ---\n";
$checks = [
    DW_OPT_REDIRECT_BASE  => dw_redirect_serialize_base($store['rules'], $store['shape']),
    DW_OPT_REDIRECT_PLAIN => dw_redirect_serialize_export($store['rules'], 'plain'),
    DW_OPT_REDIRECT_REGEX => dw_redirect_serialize_export($store['rules'], 'regex'),
];
$allMatch = true;
foreach ($checks as $name => $rebuilt) {
    $current = (string) ($store['options'][$name]['option_value'] ?? '');
    $same    = $rebuilt === $current;
    $allMatch = $allMatch && $same;
    printf("  %-40s %s (stored %d bytes, rebuilt %d bytes)\n", $name, $same ? 'IDENTICAL' : 'DIFFERS', strlen($current), strlen($rebuilt));
    if (!$same) {
        // Compare as data so ordering/format noise is visible.
        $a = @unserialize($current, ['allowed_classes' => false]);
        $b = @unserialize($rebuilt, ['allowed_classes' => false]);
        echo "     data-equal: " . (($a == $b) ? 'yes (formatting only)' : 'NO') . "\n";
        if (is_array($a) && is_array($b)) {
            echo "     counts: stored=" . count($a) . " rebuilt=" . count($b) . "\n";
        }
    }
}
echo "\n";

/* ── Normalization ── */
echo "--- dw_redirect_normalize ---\n";
foreach ([
    'blog/ehr/foo',
    '/blog/ehr/foo/',
    'https://healthray.com/blog/ehr/foo/',
    'https://www.healthray.com/blog/ehr/foo',
    'http://healthray.com/blog/ehr/foo?x=1',
    'https://example.com/other',
    '//example.com/other',
    '///blog//ehr///foo///',
    '',
] as $in) {
    $r = dw_redirect_normalize($in, $home);
    printf("  %-42s => %-34s external=%s\n", var_export($in, true), var_export($r['value'], true), $r['external'] ? 'yes' : 'no');
}
echo "\n";

/* ── Lookup against known real data ── */
echo "--- dw_redirect_find on real origins ---\n";
foreach ([
    'blog/clinic-management-systems/cloud-clinic-software-security',
    '/blog/clinic-management-systems/cloud-clinic-software-security/',
    'https://healthray.com/blog/clinic-management-systems/cloud-clinic-software-security/',
    'BLOG/Clinic-Management-Systems/Cloud-Clinic-Software-Security',
    'blog/definitely/not/a/real/path',
] as $probe) {
    $hit = dw_redirect_find($store, $probe, $home);
    printf("  %-72s => %s\n", $probe, $hit ? ('type ' . $hit['type'] . ' -> "' . $hit['url'] . '"') : 'none');
}
echo "\n";

/* ── Validation guards (pure functions, no writes) ── */
echo "--- dw_redirect_validate guards ---\n";
$cases = [
    ['new-origin-abc', 410, '',                'fresh 410'],
    ['new-origin-abc', 301, '',                '301 with no target -> error'],
    ['new-origin-abc', 301, 'new-origin-abc',  'self loop -> error'],
    ['new-origin-abc', 301, 'blog/clinic-management-systems/cloud-clinic-software-security', 'target has a 410 -> warning'],
    ['new-origin-abc', 301, 'best-pharmacy-software', 'target is itself a 301 -> chain warning'],
    ['blog/clinic-management-systems/cloud-clinic-software-security', 410, '', 'existing origin -> duplicate detected'],
    ['https://example.com/x', 301, 'y',        'external origin -> error'],
    ['new-origin-abc', 999, '',                'bad type -> error'],
    ['best-hospital-management-software-narnia', 410, '', 'covered by an existing regex -> warning'],
    ['new-origin-abc', 301, 'https://example.com/landing', 'external target is allowed'],
];
foreach ($cases as [$o, $t, $tg, $label]) {
    $v = dw_redirect_validate($store, $o, $t, $tg, $home);
    printf("  %-46s ok=%-5s err=%-52s existing=%-6s warnings=%d\n",
        $label, $v['ok'] ? 'yes' : 'no', $v['error'] !== '' ? $v['error'] : '-',
        $v['existing'] ? ('type' . $v['existing']['type']) : 'no', count($v['warnings']));
    foreach ($v['warnings'] as $w) echo "        ! $w\n";
}

echo "\nROUND-TRIP SAFE TO WRITE: " . ($allMatch ? 'YES' : 'NO — investigate before writing') . "\n";
