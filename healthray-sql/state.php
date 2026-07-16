<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <link rel="stylesheet" href="../bootstrap-5.3.3/dist/css/bootstrap.css">
</head>

<body>
    <style>
        * {
            font-size: 15px;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            overflow: auto;
            height: 100px;
        }

        table thead th {
            background-color: #856996 !important;
            color: #fff !important;
            position: sticky;
            top: 20px;
        }
    </style>

    <h3 class="notice" align='center'> Add <code>?best</code> param to view </h3>

    <?php
    if (isset($_GET['best']) && !empty($_GET['best'])) {
        $template = $_GET['best'];
    } else {
        $template = 'ehr';
    }
   require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';


    $res = $conn->query("SELECT p.id,p.post_name,p.post_title,p.menu_order,p.* From wp_posts p  WHERE post_type ='page' AND post_title like '$template%' ORDER BY p.menu_order ASC");
    if (mysqli_num_rows($res) > 0) {
        while ($temp = $res->fetch_assoc()) {
            $id = $temp['id'];
            $state[] = $temp;
        }
        $result = ['success' => true, "msg" => "List Successfull", "data" => $state];
    } else {
        $result = ['success' => false, "msg" => "Not Found", "data" => NULL];
    }
    ?>
    <div class="p-3">
        <table border="1" width=100% class="table table-bordered">
            <?php if ($result['success']) { ?>
                <thead>
                    <tr>
                        <th>No.</th>
                        <th>id</th>
                        <th>post_title</th>
                        <th>post_name</th>
                        <th>menu_order</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($state as $key => $value) {
                        $menuOrder = $value['menu_order']; ?>
                        <tr>
                            <td><?= ++$key; ?></td>
                            <td><?= $value['id']; ?></td>
                            <td><?= $value['post_title']; ?></td>
                            <td><?= $value['post_name']; ?></td>
                            <td><?= $value['menu_order']; ?></td>
                        </tr>
                    <?php } ?>
                </tbody>
            <?php } else { ?>
                <tr>
                    <td colspan="10" align="center"><?= $result['msg']; ?></td>
                </tr>
            <?php } ?>
        </table>

    </div>

</body>

</html>