<?php
$process = $_POST['process'];
$folderName = isset($_POST['folderName']) ? trim($_POST['folderName']) : '';
$folderPath = './' . $folderName;

if ($process === 'createFolder') {
    if (preg_match('/^[a-zA-Z0-9_\-]+$/', $folderName)) {
        if (!file_exists($folderPath)) {
            if (mkdir($folderPath, 0777, true)) {
                $res['status'] = 'success';
                $res['data']['folderName'] = $folderName;
                $res['message'] = '<b>' . $folderName . '</b> Created';
            } else {
                $res['status'] = 'error';
                $res['message'] = 'Somthing Went wrong';
            }
        } else {
            $res['status'] = 'error';
            $res['message'] = 'Folder already exists';
        }
    } else {
        $res['status'] = 'error';
        $res['message'] = 'Enter Valid name';
    }
} else if ($process === 'deleteFolder') {
    if (file_exists($folderPath)) {
        if (rmdir($folderPath)) {
            $res['status'] = 'success';
            $res['message'] = 'Folder Deleted';
        } else {
            $res['status'] = 'error';
            $res['message'] = 'Somthing Went wrong';
        }
    } else {
        $res['status'] = 'error';
        $res['message'] = 'Folder does not exist';
    }
} else {
    $res['status'] = 'error';
    $res['message'] = 'Something went wrong';
}


echo json_encode([...$res,]);
