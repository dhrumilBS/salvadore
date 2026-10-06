<?php
// run.php — executes code submitted from the editor and returns its output.
// NOTE: This is a sandboxed-ish dev runner for LOCALHOST use only. It uses
// eval() which is inherently dangerous; do NOT expose this on a public server.

header("Content-Type: text/html; charset=UTF-8");

if ($_SERVER["REQUEST_METHOD"] !== "POST" || !isset($_POST["code"])) {
    echo "<pre style='color:#c00;font-family:monospace;padding:10px'>No code received.</pre>";
    exit;
}

$code = (string) $_POST["code"];

// Block obviously dangerous functions for a little safety while developing.
$blocked = [
    'exec', 'shell_exec', 'system', 'passthru', 'proc_open', 'popen',
    'pcntl_exec', 'unlink', 'rmdir', 'fwrite', 'file_put_contents',
    'fopen', 'curl_exec', 'eval', 'assert', 'mail', 'symlink', 'chmod',
];
foreach ($blocked as $fn) {
    if (preg_match('/\b' . preg_quote($fn, '/') . '\s*\(/i', $code)) {
        echo "<pre style='color:#c00;font-family:monospace;padding:10px'>"
           . "Blocked: use of <b>" . htmlspecialchars($fn) . "()</b> is not allowed in the runner.</pre>";
        exit;
    }
}

// Capture output and any errors.
ini_set('display_errors', '1');
error_reporting(E_ALL);

ob_start();
try {
    // The submitted code may contain inline HTML + <?php ... blocks,
    // so we close PHP before eval'ing it (same convention as a .php file).
    eval('?>' . $code);
} catch (Throwable $e) {
    echo "<pre style='color:#c00;font-family:monospace;padding:10px'>"
       . htmlspecialchars(get_class($e) . ': ' . $e->getMessage()
         . ' on line ' . $e->getLine()) . "</pre>";
}
$out = ob_get_clean();

echo $out;
