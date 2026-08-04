<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$temp = (isset($_GET['best']) && !empty($_GET['best'])) ? $_GET['best'] : 'hms';

$state = [];
$t = [
    "hms" => "templates/template-state-city.php",
    "emr" => "templates/template-emr-state.php",
    "ehr" => "templates/template-ehr-state.php",
    "lab" => "templates/template-lab-state.php",
    "pms" => "templates/template-pms-state.php",
];
$template = $t[$temp];

$query = "SELECT p.id AS main_id,
p.post_name AS main_post_name,
p.post_title AS main_post_title,
p.menu_order AS main_menu_order,
pm.meta_key AS main_meta_key,
pm.meta_value AS main_meta_value,
mc.meta_value AS main_canonical,

sub_p.id AS sub_id,
sub_p.post_name AS sub_post_name,
sub_p.post_title AS sub_post_title,
sub_p.menu_order AS sub_menu_order,
sub_pm.meta_key AS sub_meta_key,
sub_pm.meta_value AS sub_meta_value,
sc.meta_value AS sub_canonical

FROM wp_posts p
    INNER JOIN wp_postmeta pm ON p.id = pm.post_id
    LEFT JOIN wp_postmeta sub_pm ON sub_pm.meta_value = p.id
    LEFT JOIN wp_postmeta mc ON mc.post_id = p.id 
        AND mc.meta_key = '_yoast_wpseo_canonical'
    LEFT JOIN wp_posts sub_p ON sub_pm.post_id = sub_p.id AND sub_p.post_type = 'page'
    LEFT JOIN wp_postmeta sc ON sc.post_id = sub_p.id 
        AND sc.meta_key = '_yoast_wpseo_canonical'
    WHERE 
        p.post_type = 'page' AND pm.meta_value = '$template'
    ORDER BY 
        p.post_title ASC, sub_p.post_title ASC;";
$res = $conn->query($query);

if ($res && mysqli_num_rows($res) > 0) {
    $temp_array = [];
    $last_main_id = null;

    while ($row = $res->fetch_assoc()) {
        $main_id = $row['main_id'];

        if ($main_id !== $last_main_id && $last_main_id !== null) {
            $state[count($state) - 1]["textdata"] = $temp_array;
            $temp_array = [];
        }


        if ($main_id !== $last_main_id) {
            // Start a new card entry
            $card = [
                'id' => $row['main_id'],
                'post_name' => $row['main_post_name'],
                'post_title' => $row['main_post_title'],
                'menu_order' => $row['main_menu_order'],
                'meta_key' => $row['main_meta_key'],
                'meta_value' => $row['main_meta_value'],
                'canonical' => $row['main_canonical'],
            ];
            $state[] = $card;
            $last_main_id = $main_id;
        }

        if ($row['sub_id'] !== null) {
            // Add sub-post details
            $temp_array[] = [
                'id' => $row['sub_id'],
                'post_name' => $row['sub_post_name'],
                'post_title' => $row['sub_post_title'],
                'menu_order' => $row['sub_menu_order'],
                'meta_key' => $row['sub_meta_key'],
                'meta_value' => $row['sub_meta_value'],
                'canonical' => $row['sub_canonical'],
            ];
        }
    }

    // Ensure to add textdata for the last main post
    if (!empty($temp_array)) {
        $state[count($state) - 1]["textdata"] = $temp_array;
    }

    $result = ['success' => true, "msg" => "List Successful", "data" => $state];
} else {
    $result = ['success' => false, "msg" => "No data found"];
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
    <script src ="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"> </script>
</head>

<body>
    <h3 class="notice"> Add <code>?best</code> param to view </h3>
    <div class="btn-group" id="pageFilter">
        <a href="?best=hms" data-temp="hms" class="btn btn-warning">hms</a>
        <a href="?best=emr" data-temp="emr" class="btn btn-warning">emr</a>
        <a href="?best=ehr" data-temp="ehr" class="btn btn-warning">ehr</a>
        <a href="?best=lab" data-temp="lab" class="btn btn-warning">lab</a>
        <a href="?best=pms" data-temp="pms" class="btn btn-warning">pms</a>
    </div>

    <div class="p-3">
        <div class="accordion list-group " id="accordionExample">

            <div class="d-flex fw-bold list-group-item p-0">
                <div class="p-2 col-1">No.</div>
                <div class="p-2 col-1">ID</div>
                <div class="p-2 col-2">Post Title</div>
                <div class="p-2 col-2">Post Name</div>
                <div class="p-2 col-2">Canonical</div>
                <div class="p-2 col-1">Menu Order</div>
                <div class="p-2 col-1">Action</div>
                <div class="p-2 col-1">Total <span class="pageCount"></span></div>
            </div>

            <?php foreach ($result['data'] as $key => $value) { ?>
                <div class="accordion-item list-group-item p-0">

                    <div class="d-flex">
                        <div class="p-2 col-1"><?= ++$key; ?></div>
                        <div class="p-2 col-1"><?= $value['id']; ?></div>
                        <div class="p-2 col-2"><?= $value['post_title']; ?></div>
                        <div class="p-2 col-2"><?= $value['post_name']; ?></div>
                        <div class="p-2 col-2"><?= $value['canonical']; ?></div>
                        <div class="p-2 col-1"><?= $value['menu_order']; ?></div>
                        <div class="p-2 col-1">
                            <button class="btn btn-sm btn-primary" type="button" data-bs-toggle="collapse" data-bs-target="#collapse<?= $value['id']; ?>">
                                More
                            </button>
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
    <script>
        document.addEventListener("DOMContentLoaded", () => {
            console.log([...document.querySelectorAll("#pageFilter a")]);

            [...document.querySelectorAll("#pageFilter a")].map(a =>
                a.addEventListener("click", e => {
                    e.preventDefault();
                    const url = new URLSearchParams(location.search);
                    url.set("best", a.dataset.temp);
                    location.search = url;
                })
            );
        });
    </script>

</body>

</html>