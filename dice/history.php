<?php
$file = 'roll_history.txt';
if (file_exists($file)) {
    $history = file_get_contents($file);
    echo nl2br($history); // Display history with line breaks
} else {
    echo "No history available.";
}