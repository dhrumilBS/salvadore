<?php
/*
 * Link Fixer tab (the former ../post-content tool): find every <a href> in
 * post_content AND in ACF FAQ answer fields, and rewrite or unlink them in
 * place.
 *
 * Extraction here is regex-based on purpose, unlike lib/link_extractor.php's
 * DOM parse: a write has to find the exact bytes it read, so every link keeps
 * its raw `href` (entities and relative paths untouched) next to the decoded
 * absolute `url` used for display and live checks. Writes match on the raw
 * href, inside <a> tags only.
 *
 * Every write is journaled (dw_fx_journal_*) with the field's previous value,
 * so it can be undone from the History drawer - and an undo is refused when
 * the field has changed since, rather than clobbering a newer edit.
 */

/** ACF repeater FAQ answers live in postmeta as e.g. "blog_faqs_0_answer" / "faqs_2_answer". */
const DW_FX_FAQ_KEY_REGEX = '_[0-9]+_answer$';

/** Is $key an FAQ answer field this tool may read and write? Never a hidden/underscore key. */
function dw_fx_is_faq_key($key)
{
    return is_string($key) && $key !== '' && $key[0] !== '_' && preg_match('/' . DW_FX_FAQ_KEY_REGEX . '/', $key);
}

/** Opening <a> tag with a quoted href: 1 = quote, 2 = raw href value. */
const DW_FX_A_OPEN = '/<a\b[^>]*?\shref\s*=\s*(["\'])(.*?)\1[^>]*>/si';
/** Whole <a ...>inner</a>: 1 = quote, 2 = raw href, 3 = inner HTML. */
const DW_FX_A_FULL = '/<a\b[^>]*?\shref\s*=\s*(["\'])(.*?)\1[^>]*>(.*?)<\/a\s*>/si';

/** Host without "www.", lowercased - internal/external is decided on this. */
function dw_fx_bare_host($url)
{
    return strtolower(preg_replace('/^www\./i', '', (string) parse_url((string) $url, PHP_URL_HOST)));
}

/**
 * Every link in one HTML blob, in document order.
 * @return array<int, array{href:string,url:string,anchor_text:string,is_internal:bool,is_utm:bool}>
 */
function dw_fx_extract_links($html, $baseUrl, $siteHost)
{
    $html = (string) $html;
    if ($html === '' || stripos($html, '<a') === false) {
        return [];
    }
    preg_match_all(DW_FX_A_FULL, $html, $matches, PREG_SET_ORDER);

    $out = [];
    foreach ($matches as $m) {
        $href    = $m[2];
        $decoded = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($decoded === '' || $decoded[0] === '#' || preg_match('/^(mailto|tel|javascript|data|sms):/i', $decoded)) {
            continue;
        }
        $url  = dw_resolve_url($decoded, $baseUrl);
        $host = dw_fx_bare_host($url);

        $anchor = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($m[3]), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        $query  = (string) parse_url($url, PHP_URL_QUERY);

        $out[] = [
            'href'        => $href,
            'url'         => $url,
            'anchor_text' => $anchor !== '' ? $anchor : '(no text)',
            'is_internal' => $host === '' || ($siteHost !== '' && $host === $siteHost),
            'is_utm'      => (bool) preg_match('/(^|&)utm_/i', $query),
        ];
    }
    return $out;
}

/**
 * The ways a searched URL can actually be spelled inside stored HTML: as
 * typed, with & entity-encoded (the block editor stores &amp;), and - for
 * this site's own absolute URLs - as the root-relative path.
 */
function dw_fx_needle_variants($needle, $home)
{
    $variants = [$needle, str_replace('&', '&amp;', $needle)];
    $origin = preg_replace('#^(https?://[^/]+).*$#i', '$1', (string) $home);
    foreach ([$origin, preg_replace('#^(https?://)#i', '$1www.', $origin), preg_replace('#^(https?://)www\.#i', '$1', $origin)] as $o) {
        if ($o !== '' && stripos($needle, $o . '/') === 0) {
            $path = substr($needle, strlen($o));
            $variants[] = $path;
            $variants[] = str_replace('&', '&amp;', $path);
        }
    }
    return array_values(array_unique($variants));
}

/**
 * Extra WHERE for the "Find links containing…" search: posts whose content,
 * or one of whose FAQ answer fields, contains any spelling of the needle.
 * Returns [sql, params].
 */
function dw_fx_link_search_where(array $variants)
{
    $content = [];
    $meta = [];
    $contentParams = [];
    $metaParams = [];
    foreach ($variants as $v) {
        $like = '%' . dw_like_escape($v) . '%';
        $content[] = 'p.post_content LIKE ?';
        $meta[] = 'fm.meta_value LIKE ?';
        $contentParams[] = ['type' => 's', 'value' => $like];
        $metaParams[] = ['type' => 's', 'value' => $like];
    }
    $sql = '(' . implode(' OR ', $content) . " OR EXISTS (SELECT 1 FROM wp_postmeta fm WHERE fm.post_id = p.ID
            AND fm.meta_key NOT LIKE '\\_%' AND fm.meta_key REGEXP ? AND (" . implode(' OR ', $meta) . ')))';
    return [$sql, array_merge($contentParams, [['type' => 's', 'value' => DW_FX_FAQ_KEY_REGEX]], $metaParams)];
}

/** FAQ answer fields for a set of posts: post_id => [[meta_key, meta_value], ...]. */
function dw_fx_faq_fields(mysqli $conn, array $postIds)
{
    $out = [];
    if (!$postIds) {
        return $out;
    }
    $ph = implode(',', array_fill(0, count($postIds), '?'));
    $stmt = $conn->prepare("SELECT post_id, meta_key, meta_value FROM wp_postmeta
        WHERE post_id IN ($ph) AND meta_key NOT LIKE '\\_%' AND meta_key REGEXP ?
        ORDER BY post_id, meta_key");
    $params = array_map(fn($id) => ['type' => 'i', 'value' => (int) $id], $postIds);
    $params[] = ['type' => 's', 'value' => DW_FX_FAQ_KEY_REGEX];
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $out[(int) $row['post_id']][] = $row;
    }
    return $out;
}

/* ══════════════════════════ Reading / writing one field ══════════════════════════ */

/**
 * Read the field a link lives in - post_content, or one FAQ answer field -
 * row-locked (call inside a transaction). Returns [value, title] or null.
 */
function dw_fx_fetch_source(mysqli $conn, $postId, $source, $metaKey)
{
    $stmt = $conn->prepare('SELECT post_title, post_content FROM wp_posts WHERE ID = ? FOR UPDATE');
    $stmt->bind_param('i', $postId);
    $stmt->execute();
    $post = $stmt->get_result()->fetch_assoc();
    if (!$post) {
        return null;
    }
    $post['post_title'] = html_entity_decode((string) $post['post_title'], ENT_QUOTES | ENT_HTML5, 'UTF-8'); // for the journal/History only
    if ($source !== 'faq') {
        return [$post['post_content'], $post['post_title']];
    }

    $stmt = $conn->prepare('SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? ORDER BY meta_id LIMIT 1 FOR UPDATE');
    $stmt->bind_param('is', $postId, $metaKey);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? [$row['meta_value'], $post['post_title']] : null;
}

function dw_fx_save_source(mysqli $conn, $postId, $source, $metaKey, $value)
{
    if ($source === 'faq') {
        $stmt = $conn->prepare('UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?');
        $stmt->bind_param('sis', $value, $postId, $metaKey);
        $ok = $stmt->execute();
        // The post itself changed too, as far as caches/sitemaps/"recently modified" lists care.
        $stmt = $conn->prepare('UPDATE wp_posts SET post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?');
        $stmt->bind_param('i', $postId);
        return $ok && $stmt->execute();
    }
    $stmt = $conn->prepare('UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?');
    $stmt->bind_param('si', $value, $postId);
    return $stmt->execute();
}

/** Encode a URL for an href attribute delimited by $quote, without double-encoding existing entities. */
function dw_fx_href_attr($url, $quote)
{
    $url = str_replace(['<', '>'], ['%3C', '%3E'], $url);
    return $quote === '"' ? str_replace('"', '&quot;', $url) : str_replace("'", '&#39;', $url);
}

/** Rewrite href="$oldHref" -> $newUrl in every <a> tag. Returns [newHtml, count]. */
function dw_fx_replace_href($html, $oldHref, $newUrl)
{
    $count = 0;
    $out = preg_replace_callback(DW_FX_A_OPEN, function ($m) use ($oldHref, $newUrl, &$count) {
        if ($m[2] !== $oldHref) {
            return $m[0];
        }
        $count++;
        // Same first-\shref rule as DW_FX_A_OPEN, so it's the attribute that matched (never data-href).
        return preg_replace_callback('/(\shref\s*=\s*)(["\'])(.*?)\2/si',
            fn($a) => $a[1] . $a[2] . dw_fx_href_attr($newUrl, $a[2]) . $a[2], $m[0], 1);
    }, $html);
    return [$out ?? $html, $count];
}

/**
 * Unlink every <a href="$href">…</a>: the tag goes, its inner HTML (text plus
 * any <strong>/<em> formatting) stays exactly where it was. Returns [newHtml, count].
 */
function dw_fx_unlink_href($html, $href)
{
    $count = 0;
    $out = preg_replace_callback(DW_FX_A_FULL, function ($m) use ($href, &$count) {
        if ($m[2] !== $href) {
            return $m[0];
        }
        $count++;
        return $m[3];
    }, $html);
    return [$out ?? $html, $count];
}

/** Only real link targets may be written - never javascript:, data: and the like. */
function dw_fx_valid_new_url($url)
{
    return $url !== '' && !preg_match('/\s/', $url) && preg_match('#^(https?://[^/\s]+|/|\#|mailto:|tel:)#i', $url);
}

/**
 * Apply one replace/unlink to one field, atomically, and journal it.
 * $item: post_id, href, source, meta_key, new_url (replace only).
 * Returns ['status' => updated|removed|no_change|error, ...].
 */
function dw_fx_apply(mysqli $conn, $op, array $item, $dbKey)
{
    $postId  = (int) ($item['post_id'] ?? 0);
    $href    = (string) ($item['href'] ?? '');
    $source  = ($item['source'] ?? 'content') === 'faq' ? 'faq' : 'content';
    $metaKey = $source === 'faq' ? (string) ($item['meta_key'] ?? '') : null;
    $newUrl  = trim((string) ($item['new_url'] ?? ''));

    if ($postId <= 0 || $href === '') {
        return ['status' => 'error', 'message' => 'Missing post or link'];
    }
    if ($source === 'faq' && !dw_fx_is_faq_key($metaKey)) {
        return ['status' => 'error', 'message' => 'Not an FAQ answer field'];
    }
    if ($op === 'replace' && !dw_fx_valid_new_url($newUrl)) {
        return ['status' => 'error', 'message' => 'New URL must start with https://, http:// or /'];
    }

    $conn->begin_transaction();
    try {
        $found = dw_fx_fetch_source($conn, $postId, $source, $metaKey);
        if ($found === null) {
            $conn->rollback();
            return ['status' => 'error', 'message' => $source === 'faq' ? 'FAQ field not found' : 'Post not found'];
        }
        [$before, $title] = $found;

        [$after, $count] = $op === 'unlink'
            ? dw_fx_unlink_href($before, $href)
            : dw_fx_replace_href($before, $href, $newUrl);

        if (!$count || $after === $before) {
            $conn->rollback();
            return ['status' => 'no_change', 'message' => 'Link not found in ' . ($source === 'faq' ? 'the FAQ field' : 'the post content') . ' - it may have changed since this page loaded'];
        }

        if (!dw_fx_save_source($conn, $postId, $source, $metaKey, $after)) {
            $conn->rollback();
            return ['status' => 'error', 'message' => 'Database write failed'];
        }
        $conn->commit();
    } catch (Throwable $e) {
        $conn->rollback();
        return ['status' => 'error', 'message' => 'Database error: ' . $e->getMessage()];
    }

    $entry = dw_fx_journal_append($dbKey, [
        'action'   => $op,
        'post_id'  => $postId,
        'title'    => $title,
        'source'   => $source,
        'meta_key' => $metaKey,
        'from'     => html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'to'       => $op === 'unlink' ? '' : $newUrl,
        'count'    => $count,
    ], $before, $after);

    $result = ['status' => $op === 'unlink' ? 'removed' : 'updated', 'count' => $count, 'journal_id' => $entry['id'] ?? null];
    if ($op === 'replace') {
        $result['new_href'] = dw_fx_href_attr($newUrl, '"');
    }
    return $result;
}

/* ══════════════════════════ Change journal (History + Undo) ══════════════════════════
 * One append-only JSON-lines file per site in ../../backups (web access
 * denied by its .htaccess). Each line holds the field's full previous value
 * (deflated) and a hash of the value written, which is what makes a safe
 * undo possible. */

function dw_fx_journal_file($dbKey)
{
    $dir = __DIR__ . '/../../backups';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        return '';
    }
    $guard = $dir . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }
    return $dir . '/link-changes-' . (preg_replace('~[^a-z0-9_-]~i', '', (string) $dbKey) ?: 'default') . '.jsonl';
}

function dw_fx_journal_append($dbKey, array $entry, $before, $after)
{
    $file = dw_fx_journal_file($dbKey);
    $entry = [
        'id'         => bin2hex(random_bytes(8)),
        't'          => date('c'),
        'site'       => $dbKey,
    ] + $entry + [
        'before'     => base64_encode(gzdeflate((string) $before, 6)),
        'after_hash' => sha1((string) $after),
    ];
    if ($file !== '') {
        @file_put_contents($file, json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n", FILE_APPEND | LOCK_EX);
    }
    return $entry;
}

/** Every journal entry, oldest first. */
function dw_fx_journal_read($dbKey)
{
    $file = dw_fx_journal_file($dbKey);
    if ($file === '' || !is_file($file)) {
        return [];
    }
    $out = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $e = json_decode($line, true);
        if (is_array($e) && isset($e['id'])) {
            $out[] = $e;
        }
    }
    return $out;
}

/**
 * Restore the value a journal entry overwrote - only while the field still
 * holds exactly what that entry wrote. The undo is itself journaled (and so
 * can be undone in turn).
 */
function dw_fx_undo(mysqli $conn, $dbKey, $id)
{
    $entries = dw_fx_journal_read($dbKey);
    $target = null;
    foreach ($entries as $e) {
        if ($e['id'] === $id) {
            $target = $e;
        }
        if (($e['undo_of'] ?? '') === $id) {
            return ['status' => 'error', 'message' => 'That change was already undone'];
        }
    }
    if (!$target) {
        return ['status' => 'error', 'message' => 'Change not found in this site\'s history'];
    }

    $postId  = (int) $target['post_id'];
    $source  = $target['source'] === 'faq' ? 'faq' : 'content';
    $metaKey = $source === 'faq' ? (string) $target['meta_key'] : null;
    if ($source === 'faq' && !dw_fx_is_faq_key($metaKey)) {
        return ['status' => 'error', 'message' => 'Not an FAQ answer field'];
    }
    $restore = gzinflate(base64_decode((string) $target['before']));
    if ($restore === false) {
        return ['status' => 'error', 'message' => 'The saved copy for this change is unreadable'];
    }

    $conn->begin_transaction();
    try {
        $found = dw_fx_fetch_source($conn, $postId, $source, $metaKey);
        if ($found === null) {
            $conn->rollback();
            return ['status' => 'error', 'message' => 'Post or field no longer exists'];
        }
        [$current, $title] = $found;
        if (sha1($current) !== $target['after_hash']) {
            $conn->rollback();
            return ['status' => 'conflict', 'message' => 'This ' . ($source === 'faq' ? 'FAQ field' : 'post') . ' has changed since - undo the newer changes to it first'];
        }
        if (!dw_fx_save_source($conn, $postId, $source, $metaKey, $restore)) {
            $conn->rollback();
            return ['status' => 'error', 'message' => 'Database write failed'];
        }
        $conn->commit();
    } catch (Throwable $e) {
        $conn->rollback();
        return ['status' => 'error', 'message' => 'Database error: ' . $e->getMessage()];
    }

    $entry = dw_fx_journal_append($dbKey, [
        'action'   => 'undo',
        'undo_of'  => $id,
        'post_id'  => $postId,
        'title'    => $title,
        'source'   => $source,
        'meta_key' => $metaKey,
        'from'     => $target['to'],
        'to'       => $target['from'],
        'count'    => $target['count'] ?? 1,
    ], $current, $restore);

    return ['status' => 'undone', 'journal_id' => $entry['id'], 'undone' => $target];
}
