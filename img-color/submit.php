<?php
if ($_FILES['fileUpload']['name'] != "") {
}

echo json_encode([
    'status' => true,
    'data' => [
        'date' => $_POST['date'],
        'filename' => $_FILES['fileUpload']['name']
    ]
]); 