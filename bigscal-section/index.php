<?php
function listDirectory($dir) {
    $files = array_diff(scandir($dir), ['.', '..']);
    echo "<ul>";
    foreach ($files as $file) {
        $path = $dir . DIRECTORY_SEPARATOR . $file;
        $relativePath = str_replace(__DIR__ . DIRECTORY_SEPARATOR, '', $path);

        if (is_dir($path)) {
            echo "<li class='folder'>
                    <span class='folder-label'>📁 $file</span>";
            listDirectory($path);
            echo "</li>";
        } else {
            echo "<li class='file'>📄 <a href='$relativePath' target='_blank'>$file</a></li>";
        }
    }
    echo "</ul>";
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Bigscal Directory Viewer</title>
    <link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="container">
    <h2>📂 Bigscal – Directory Explorer</h2>
    <?php listDirectory(__DIR__); ?>
</div>
<script src="assets/script.js"></script>
</body>
</html>
