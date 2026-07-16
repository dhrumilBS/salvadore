<pre><?php
        require_once $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

        $query = "SELECT * FROM wp_cf7anyapi_entries WHERE field_value LIKE '%dhrumil%'";
        $res = $conn->query($query);

        while ($row = $res->fetch_assoc()) {
            $data[$row['data_id']][$row['field_name']] = $row['field_value'];
        }

        while ($row = $res->fetch_assoc()) {
            $data[] = $row;
        }

        print_r($data);
        ?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <link rel="stylesheet" href="../bootstrap/dist/css/bootstrap.css">
    <script src="../bootstrap/dist/js/bootstrap.bundle.js"></script>
</head>

<body>
    <h3 class="notice"> Add <code>?best</code> param to view </h3>
    <div class="p-3">
        <div class="accordion list-group " id="accordionExample">

            <div class="d-flex fw-bold list-group-item p-0">
                <div class="p-2 col-1">No.</div>
                <div class="p-2 col-1">id</div>
                <div class="p-2 col-2">data_id</div>
                <div class="p-2 col-2">field_name</div>
                <div class="p-2 col-2">field_value</div>
                <div class="p-2 col-1">Action</div>
                <div class="p-2 col-1">Total <span class="pageCount"></span></div>
            </div>

            <?php foreach ($state as $key => $value) { ?>
                <div class="accordion-item list-group-item p-0">

                    <div class="d-flex">
                        <div class="p-2 col-1"><?= ++$key; ?></div>
                        <div class="p-2 col-1"><?= $value['id']; ?></div>
                        <div class="p-2 col-2"><?= $value['data_id']; ?></div>
                        <div class="p-2 col-2"><?= $value['field_name']; ?></div>
                        <div class="p-2 col-2"><?= $value['field_value']; ?></div>
                        <div class="p-2 col-1">
                            <button class="btn btn-sm btn-primary" type="button" data-bs-toggle="collapse" data-bs-target="#collapse<?= $value['id']; ?>"> More </button>
                        </div>
                        <span class="pageCount"></span>
                    </div>

                    <?php
                    if (1 == 1 && !empty($value['textdata']) && is_array($value['textdata'])) {
                    ?>
                        <div id="collapse<?= $value['id']; ?>" class="collapse m-2 mt-0" data-bs-parent="#accordionExample">

                            <div class="card bg-light card-body p-3 list-group">
                                <div class="d-flex fw-bold list-group-item">
                                    <div class="col">No.</div>
                                    <div class="col">ID</div>
                                    <div class="col-3">Post Title</div>
                                    <div class="col-3">Post Name</div>
                                    <div class="col-3">canonical</div>
                                    <div class="col text-center">Menu Order</div>
                                </div>
                                <?php
                                foreach ($value['textdata'] as $subKey => $val) {
                                    if (preg_match('/In (\w+(?:[ -]\w+){0,3})/', $val['post_title'], $matches))
                                        $post_title = $matches[1];
                                ?>
                                    <div class="d-flex list-group-item">
                                        <div class="col"><?= ++$subKey; ?></div>
                                        <div class="col"><?= $val['id']; ?></div>
                                        <div class="col-3"><?= $val['post_title']; ?></div>
                                        <div class="col-3"><?= $val['post_name']; ?></div>
                                        <div class="col-3"><?= $val['canonical']; ?></div>
                                        <div class="col text-center"><?= $val['menu_order']; ?></div>
                                    </div>
                                <?php } ?>
                            </div>

                        </div>
                    <?php } ?>
                </div>
            <?php } ?>
        </div>
    </div>

</body>

</html>