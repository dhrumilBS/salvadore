<?php
// store_roll.php

if (isset($_POST['dice1']) && isset($_POST['dice2']) && isset($_POST['player'])) {
    $dice1 = intval($_POST['dice1']);
    $dice2 = intval($_POST['dice2']);
    $player = intval($_POST['player']);

    // Store the roll data in a file (you can use a database here)
    $file = 'roll_history.txt';
    $currentData = file_get_contents($file);
    $newRoll = "Player $player: " . ($player === 1 ? $dice1 : $dice2) . "\n";
    file_put_contents($file, $newRoll . $currentData);

    echo "Roll saved: $newRoll";
} else {
    echo "No dice roll received";
}
