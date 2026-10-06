<?php
function deleteDir($dirPath)
{
    if (!is_dir($dirPath)) {
        return ["status" => false, "message" => "$dirPath is not a valid directory."];
    }

    if (substr($dirPath, -1) != '/') {
        $dirPath .= '/';
    }

    $files = glob($dirPath . '*', GLOB_MARK);
    foreach ($files as $file) {
        if (is_dir($file)) {
            deleteDir($file);
        } else {
            unlink($file);
        }
    }

    if (rmdir($dirPath)) {
        return ["status" => true, "message" => "Deleted: $dirPath"];
    } else {
        return ["status" => false, "message" => "Failed to delete: $dirPath"];
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['inputCheckbox']) && is_array($_POST['inputCheckbox'])) {
    $folders = $_POST['inputCheckbox'];
    $folderResponses = [];

    foreach ($folders as $folder) {
        $folderResponses[] = deleteDir($folder);
    }

    echo json_encode(["status" => true, "results" => $folderResponses]);
} else {
    echo json_encode(["status" => false, "message" => "No folders received for deletion."]);
}
