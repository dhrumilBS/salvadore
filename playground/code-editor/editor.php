<!-- index.php -->
<?php
$code = isset($_POST['code']) ? $_POST['code'] : '';
file_put_contents('temp.php', $code);
include 'temp.php';
?>

<?php
if ($_SERVER["REQUEST_METHOD"] == "POST" && isset($_POST["code"])) {
    $code = $_POST["code"];

    // Disable dangerous PHP functions for security
    $disabledFunctions = [
        'exec',
        'shell_exec',
        'system',
        'passthru',
        'proc_open',
        'popen',
        'pcntl_exec'
    ];
    foreach ($disabledFunctions as $func) {
        if (stripos($code, $func) !== false) {
            die("<h3 style='color: red;'>Error: Forbidden function used in code!</h3>");
        }
    }

    // Capture PHP output
    ob_start();
    eval("?>$code<?php ");
    $output = ob_get_clean();

    // Return the HTML output
    echo $output;
} else {
    echo "<h3 style='color: red;'>No code received.</h3>";
}
?>