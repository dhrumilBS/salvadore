<?php
/*
 * POST api/read_doc.php  {documentId}  ->  {html} | {error}
 *
 * Reads a Google Doc with the Bigscal service account and turns it into the
 * simple HTML the builder expects (headings, paragraphs, lists, bold/italic/
 * underline/strike, colour, links). Replaces the old `node server.js` - runs in
 * Apache, so it works from every PC on the network, nothing to start.
 *
 * Needs ../service-account.json (Google Cloud service account with the Google
 * Docs API enabled; .htaccess never serves that file). The doc must be shared
 * with the service account's email, or set to "Anyone with the link".
 * LAN-only (see /salvadore/.htaccess): the account can read company docs.
 */
// Included from the command line (tests): only define the functions below.
if (PHP_SAPI === 'cli') return;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    out(405, ['error' => 'POST only']);
}
// Only this tool's own page: it sends the header, a cross-site form can't.
if (($_SERVER['HTTP_X_BLOG_BUILDER'] ?? '') !== '1') {
    out(403, ['error' => 'Request refused - open the Blog Content Builder page to load a doc.']);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
$documentId = is_array($input) ? (string) ($input['documentId'] ?? '') : '';
if (!preg_match('/^[A-Za-z0-9_-]{20,}$/', $documentId)) {
    out(400, ['error' => 'Document ID is required']);
}

/* ───── service-account access token (cached until shortly before it expires) ───── */
function b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function http_json(string $method, string $url, array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) return [0, ['error' => ['message' => "Could not reach Google: $err"]]];
    return [$status, json_decode($raw, true) ?: []];
}

function access_token(array $key): string
{
    $cache = sys_get_temp_dir() . '/bigscal_docs_token_' . sha1($key['client_email']) . '.json';
    $cached = @json_decode((string) @file_get_contents($cache), true);
    if (is_array($cached) && ($cached['expires'] ?? 0) > time() + 60) return $cached['token'];

    $now = time();
    $claims = [
        'iss' => $key['client_email'],
        'scope' => 'https://www.googleapis.com/auth/documents.readonly',
        'aud' => $key['token_uri'] ?? 'https://oauth2.googleapis.com/token',
        'iat' => $now,
        'exp' => $now + 3600,
    ];
    $unsigned = b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])) . '.' . b64url(json_encode($claims));
    if (!openssl_sign($unsigned, $sig, $key['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('The service-account key could not sign a request (bad private_key?)');
    }
    [$status, $json] = http_json('POST', $claims['aud'], ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $unsigned . '.' . b64url($sig),
    ]));
    if ($status !== 200 || empty($json['access_token'])) {
        $why = $json['error_description'] ?? $json['error']['message'] ?? $json['error'] ?? "HTTP $status";
        if (is_string($why) && stripos($why, 'Invalid JWT Signature') !== false) {
            // The key was deleted / disabled in Google Cloud - only a new key fixes it.
            $why = "this key is no longer valid (deleted or disabled in Google Cloud). Create a new JSON key for {$key['client_email']} "
                . '(Google Cloud Console > IAM > Service Accounts > Keys) and save it as tools/bigscal/service-account.json.';
        }
        throw new RuntimeException('Google refused the service account: ' . $why);
    }
    @file_put_contents($cache, json_encode(['token' => $json['access_token'], 'expires' => $now + (int) ($json['expires_in'] ?? 3600)]), LOCK_EX);
    return $json['access_token'];
}

/* ───── Google Doc JSON -> HTML (same output as the old server.js) ───── */
function run_html(array $element): string
{
    if (!isset($element['textRun'])) return '';
    $text = (string) ($element['textRun']['content'] ?? '');
    $style = $element['textRun']['textStyle'] ?? [];

    $text = str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $text);
    $text = preg_replace('/\n$/', '', $text); // Docs ends each paragraph's last run with "\n"
    if ($text === '') return '';

    if (!empty($style['bold'])) $text = "<strong>$text</strong>";
    if (!empty($style['italic'])) $text = "<em>$text</em>";
    if (!empty($style['underline'])) $text = "<u>$text</u>";
    if (!empty($style['strikethrough'])) $text = "<del>$text</del>";
    $rgb = $style['foregroundColor']['color']['rgbColor'] ?? null;
    if (is_array($rgb)) {
        $c = fn($k) => (int) round(($rgb[$k] ?? 0) * 255);
        $text = '<span style="color: rgb(' . $c('red') . ',' . $c('green') . ',' . $c('blue') . ');">' . $text . '</span>';
    }
    $url = $style['link']['url'] ?? '';
    if ($url !== '') {
        $text = '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" target="_blank" rel="noopener">' . $text . '</a>';
    }
    return $text;
}

function is_ordered_list(array $doc, string $listId, int $level): bool
{
    $glyph = $doc['lists'][$listId]['listProperties']['nestingLevels'][$level]['glyphType'] ?? '';
    return $glyph !== '' && $glyph !== 'GLYPH_TYPE_UNSPECIFIED';
}

function doc_to_html(array $doc): string
{
    $html = '';
    $open = null; // ['tag' => 'ul'|'ol', 'listId' => ...]
    $close = function () use (&$html, &$open) {
        if ($open) { $html .= "</{$open['tag']}>"; $open = null; }
    };
    foreach ($doc['body']['content'] ?? [] as $element) {
        if (!isset($element['paragraph'])) { $close(); continue; }
        $p = $element['paragraph'];
        $inner = implode('', array_map('run_html', $p['elements'] ?? []));

        if (isset($p['bullet'])) {
            $listId = (string) ($p['bullet']['listId'] ?? '');
            $tag = is_ordered_list($doc, $listId, (int) ($p['bullet']['nestingLevel'] ?? 0)) ? 'ol' : 'ul';
            if (!$open || $open['listId'] !== $listId || $open['tag'] !== $tag) {
                $close();
                $html .= "<$tag>";
                $open = ['tag' => $tag, 'listId' => $listId];
            }
            $html .= "<li>$inner</li>";
            continue;
        }
        $close();
        if (trim($inner) === '') continue;

        $tag = ['HEADING_1' => 'h1', 'HEADING_2' => 'h2', 'HEADING_3' => 'h3', 'HEADING_4' => 'h4'][$p['paragraphStyle']['namedStyleType'] ?? ''] ?? 'p';
        $html .= "<$tag>$inner</$tag>";
    }
    $close();
    return $html;
}

/* ───── request ───── */
$keyFile = __DIR__ . '/../service-account.json';
$key = is_file($keyFile) ? json_decode((string) file_get_contents($keyFile), true) : null;
if (!is_array($key) || empty($key['client_email']) || empty($key['private_key'])) {
    out(500, ['error' => 'Missing or invalid tools/bigscal/service-account.json - put the Google service-account key there.']);
}

try {
    $token = access_token($key);
} catch (RuntimeException $e) {
    out(502, ['error' => 'Failed to read Google Document: ' . $e->getMessage()]);
}

[$status, $doc] = http_json('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($documentId), ['Authorization: Bearer ' . $token]);
if ($status !== 200) {
    $detail = $doc['error']['message'] ?? "HTTP $status";
    if ($status === 403 || $status === 404) {
        $detail .= " - share the doc with {$key['client_email']} or set it to \"Anyone with the link\".";
    }
    out($status ?: 502, ['error' => "Failed to read Google Document: $detail"]);
}

out(200, ['html' => doc_to_html($doc)]);
