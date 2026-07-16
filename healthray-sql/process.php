<?php

// Database connection settings
$host = '143.110.176.144';
$dbname = 'wp_healthray_landing';
$username = 'office_landing';
$password = 'Health@L@N-DB4({^&*8*U&Jg6J6P';

// echo $_POST['query'];

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $where = $_POST['where'] ??  '';
    $order = $_POST['order'] ?? 'asc';
    $order_field = $_POST['order_field'] ?? 'id';


    $query = "SELECT id,post_name,post_title,post_date,menu_order FROM wp_posts WHERE post_type='page' AND $where ORDER BY  $order_field $order";



    $stmt = $pdo->prepare($query);

    $stmt->execute();

    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if ($results) {
        echo '<table class="table table-bordered">';
        echo '<thead>';
        echo '<tr>';
        echo '<th>id</th>';
        echo '<th>post_name</th>';
        echo '<th>post_title</th>';
        echo '<th>post_date</th>';
        echo '<th>menu_order</th>';

        echo '</tr>';
        echo '<thead">';

        foreach ($results as $row) {
            echo '<tr>';
            echo '<td>' . htmlspecialchars($row['id']) . '</td>';
            echo '<td>' . htmlspecialchars($row['post_name']) . '</td>';
            echo '<td>' . htmlspecialchars($row['post_title']) . '</td>';
            echo '<td>' . htmlspecialchars($row['post_date']) . '</td>';
            echo '<td>' . htmlspecialchars($row['menu_order']) . '</td>';

            echo '</tr>';
        }
        echo '</table>';
    } else {
        echo '<div class="alert alert-info">No results found.</div>';
    }
} catch (PDOException $e) {
    echo '<div class="alert alert-danger">Database error: ' . $e->getMessage() . '</div>';
}
