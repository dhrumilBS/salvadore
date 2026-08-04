<?php
require __DIR__ . '/bootstrap.php';

// Post type is a fixed 4-way tab group in the UI (post/page/whitepaper/
// case-studies), not a dynamic dropdown, so it isn't sourced here. Author/
// category/tag filters were removed from the UI too, so this only needs
// to hand back the status list.

json_out(true, 'Filter options loaded', [
    'statuses' => ['publish', 'draft', 'pending', 'private', 'future', 'trash', 'any'],
]);
