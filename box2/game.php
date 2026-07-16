<?php
session_start();

function generate_card() {
    $card = [];
    $used_numbers = [];
    
    for ($i = 0; $i < 5; $i++) {
        $row = [];
        for ($j = 0; $j < 5; $j++) {
            do {
                $number = rand(1, 25);
            } while (in_array($number, $used_numbers));
            $used_numbers[] = $number;
            $row[] = $number;
        }
        $card[] = $row;
    }
    
    return $card;
}

// To generate a card, call this PHP script from your JavaScript (AJAX or WebSocket)
// and return the card data in JSON format.
header('Content-Type: application/json');
echo json_encode(generate_card());
?>
