<?php
// This script updates and returns the visitor count

// Read the current count from a file or database
$count = 0;
if (file_exists('visitor_count.txt')) {
    $count = intval(file_get_contents('visitor_count.txt'));
}

// Increment the count
$count++;

$content = $count;

// Save the updated count back to the file
file_put_contents('visitor_count.txt', $content);

// Return the count as JSON
echo json_encode(['count' => json_encode($count)]);
