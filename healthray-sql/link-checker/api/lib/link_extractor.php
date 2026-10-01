<?php
/*
 * Server-side <a href> extraction out of post_content. Moved here (out of
 * the browser) so a post's raw HTML never has to cross the wire just to
 * find its links — the API only ever returns the already-parsed link list,
 * which also lets domain/UTM filtering, CSV export and the live-status
 * checker all share one extraction pass instead of three.
 */

/**
 * Resolve a possibly-relative href against a base URL (root-relative "/foo",
 * protocol-relative "//host/foo", and "../foo"-style relative paths) so every
 * link this tool hands back is a real, checkable absolute URL — a plain
 * href="/" would otherwise be stored verbatim and the live checker would
 * (correctly, but uselessly) reject it for having no scheme.
 */
function lc_resolve_url($href, $base)
{
    $href = trim((string) $href);
    if ($href === '' || preg_match('#^[a-z][a-z0-9+.\-]*:#i', $href)) {
        return $href; // already absolute (or a scheme we don't touch, e.g. skipped earlier)
    }

    $baseParts = parse_url((string) $base);
    if (!$baseParts || empty($baseParts['scheme']) || empty($baseParts['host'])) {
        return $href; // no usable base to resolve against
    }
    $origin = $baseParts['scheme'] . '://' . $baseParts['host'] . (isset($baseParts['port']) ? ':' . $baseParts['port'] : '');

    if (strpos($href, '//') === 0) {
        return $baseParts['scheme'] . ':' . $href;
    }
    if ($href[0] === '/') {
        return $origin . $href;
    }

    $basePath = $baseParts['path'] ?? '/';
    $dir = substr($basePath, 0, strrpos($basePath, '/') + 1) ?: '/';
    $segments = [];
    foreach (explode('/', $dir . $href) as $seg) {
        if ($seg === '' || $seg === '.') {
            continue;
        }
        if ($seg === '..') {
            array_pop($segments);
            continue;
        }
        $segments[] = $seg;
    }
    $path = '/' . implode('/', $segments);
    if (substr($href, -1) === '/' && substr($path, -1) !== '/') {
        $path .= '/';
    }
    return $origin . $path;
}

/**
 * Parse every <a href> out of an HTML fragment.
 *
 * @param string $html     Raw post_content.
 * @param string $baseUrl  The post's own URL (guid, falling back to the site
 *                          home) — relative hrefs are resolved against this.
 * @param string $homeHost The site's own hostname (from lc_home_url), used
 *                          to flag a link as internal vs external.
 * @return array<int, array{url:string,anchor:string,domain:string,is_internal:bool,is_utm:bool,utm_params:string[]}>
 */
function lc_extract_links($html, $baseUrl, $homeHost)
{
    $html = (string) $html;
    if (trim($html) === '' || stripos($html, '<a') === false) {
        return [];
    }

    $prevErrors = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    // The leading XML PI forces DOMDocument to read the string as UTF-8
    // instead of guessing (and mangling multi-byte titles/anchors) — it is
    // consumed by the parser and never ends up in the DOM.
    $doc->loadHTML('<?xml encoding="utf-8" ?><div>' . $html . '</div>', LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    libxml_clear_errors();
    libxml_use_internal_errors($prevErrors);

    $homeHost = $homeHost ? strtolower(ltrim($homeHost, '.')) : '';
    $out = [];

    foreach ($doc->getElementsByTagName('a') as $a) {
        $href = trim((string) $a->getAttribute('href'));
        if ($href === '' || $href[0] === '#' || stripos($href, 'javascript:') === 0 || stripos($href, 'mailto:') === 0 || stripos($href, 'tel:') === 0) {
            continue;
        }
        $href = lc_resolve_url($href, $baseUrl);

        $anchor = trim(preg_replace('/\s+/', ' ', $a->textContent ?? ''));
        $parts  = parse_url($href);
        $host   = isset($parts['host']) ? strtolower($parts['host']) : '';
        $isInternal = $host === '' || ($homeHost !== '' && $host === $homeHost);
        $domain = $host !== '' ? $host : $homeHost;

        $utmParams = [];
        if (!empty($parts['query'])) {
            parse_str($parts['query'], $q);
            foreach ($q as $k => $v) {
                if (stripos((string) $k, 'utm_') === 0) {
                    $utmParams[] = $k . '=' . (is_array($v) ? implode(',', $v) : $v);
                }
            }
        }

        $out[] = [
            'url'         => $href,
            'anchor'      => $anchor,
            'domain'      => $domain,
            'is_internal' => $isInternal,
            'is_utm'      => count($utmParams) > 0,
            'utm_params'  => $utmParams,
        ];
    }

    return $out;
}

/** Site home URL (wp_options "home"), cached per request per prefix. */
function lc_home_url(mysqli $conn, $prefix)
{
    static $cache = [];
    if (isset($cache[$prefix])) {
        return $cache[$prefix];
    }
    $res = $conn->query("SELECT option_value FROM {$prefix}options WHERE option_name = 'home' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    return $cache[$prefix] = $row ? rtrim($row['option_value'], '/') : '';
}
