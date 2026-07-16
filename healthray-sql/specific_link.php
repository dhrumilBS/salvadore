<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <link rel="stylesheet" href="../bootstrap/dist/css/bootstrap.css">
</head>

<body>
    <?php
   require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';


    $op = [];

    $sql = "SELECT p.ID, p.post_title, p.post_name, p.post_status,  
  MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_meta-robots-noindex' THEN pm.meta_value END) AS noindex,
  MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_meta-robots-nofollow' THEN pm.meta_value END) AS nofollow
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
LEFT JOIN wp_postmeta tpl ON (tpl.post_id = p.ID AND tpl.meta_key = '_wp_page_template')
WHERE 
  p.post_type = 'page'
  AND p.post_status = 'publish'
  AND tpl.meta_value LIKE '%speciality.php'
GROUP BY p.ID;
";
    ?>


    <div class="p-3">
        <table border="1" width=100% class="table table-bordered">

            <tbody>
                <?php
                $ap = $conn->query($sql);
                $key = 1;
                $i = 1;
                while ($oop = $ap->fetch_assoc()) {
                    $op[] = $oop;
                    print_r($oop);
                ?>
                    <tr>
                        <td><?= $i++; ?></td>
                        <td><?= $oop['ID']; ?></td>
                        <td><?= $oop['post_name']; ?></td>
                        <td><?= $oop['post_status']; ?></td>
                        <td><?= $oop['meta_key']; ?></td>
                        <td><?= $oop['noindex']; ?></td>
                        <td><?= $oop['nofollow']; ?></td>
                    </tr>
                <?php } ?>

            </tbody>
        </table>


    </div>