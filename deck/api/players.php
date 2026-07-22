<?php 
$response = array();
if (isset($_POST)) {
    $response['success'] = true;
    $response['player'] = $_POST['numPlayers'];
}
echo json_encode($response);
