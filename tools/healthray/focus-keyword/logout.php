<?php
require_once __DIR__ . '/auth.php';

fk_logout();

header('Location: login.php');
exit;
