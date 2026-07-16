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

    $query = "SELECT p.id, p.post_name, p.post_title, p.menu_order, p.post_date, pm.meta_key, pm.meta_value, p.post_status
                FROM wp_posts p INNER JOIN wp_postmeta pm ON p.id = pm.post_id
                WHERE p.post_type = 'page' AND (pm.meta_value ='templates/template-speciality.php')
                ORDER BY p.post_name ASC;";

    $res = $conn->query($query);

    $state = [];
    if ($res && mysqli_num_rows($res) > 0) {

        while ($row = $res->fetch_assoc()) {
            $card = [
                'id' => $row['id'],
                'post_name' => $row['post_name'],
                'post_title' => $row['post_title'],
                'menu_order' => $row['menu_order'],
                'post_date' => $row['post_date'],
                'post_status' => $row['post_status'],
                'meta_key' => $row['meta_key'],
                'meta_value' => $row['meta_value'],
            ];
            $state[] = $card;
        }
        $result = ['success' => true, "msg" => "List Successful", "data" => $state];
    } else {
        $result = ['success' => false, "msg" => "No data found"];
    }
    ?>
    <div class="p-3">
        <table border="1" width=100% class="table table-bordered table-hover">
            <thead>
                <tr>
                    <th>No.:</th>
                    <th>id</th>
                    <th>post_title</th>
                    <th>post_name</th>
                    <th>post_date</th>
                    <th>post_status </th>
                    <th>menu_order </th>
                    <th>SQl</th>
                    <th>$Rr</th>
                </tr>
            </thead>

            <tbody>
                <?php foreach ($result['data'] as $key => $value): ?>
                    <tr id="row-<?= $value['id']; ?>">
                        <td><?= ++$key; ?></td>
                        <td><?= $value['id']; ?></td>
                        <td><input type="text" class="form-control" id="title-<?= $value['id']; ?>" value="<?= htmlspecialchars($value['post_title']); ?>"></td>
                        <td><input type="text" class="form-control" id="name-<?= $value['id']; ?>" value="<?= htmlspecialchars($value['post_name']); ?>"></td>
                        <td><input type="datetime" class="form-control" id="date-<?= $value['id']; ?>" value="<?= date('d-m-Y H:i:s', strtotime($value['post_date'])); ?>"></td>
                        <td>
                            <select class="form-select" id="status-<?= $value['id']; ?>">
                                <option value="publish" <?= $value['post_status'] === 'publish' ? 'selected' : '' ?>>Publish</option>
                                <option value="private" <?= $value['post_status'] === 'private' ? 'selected' : '' ?>>Private</option>
                                <option value="draft" <?= $value['post_status'] === 'draft' ? 'selected' : '' ?>>Draft</option>
                                <option value="pending" <?= $value['post_status'] === 'pending' ? 'selected' : '' ?>>Pending</option>
                            </select>
                        </td>
                        <td><input type="number" class="form-control" id="order-<?= $value['id']; ?>" value="<?= $value['menu_order']; ?>"></td>
                        <td>
                            <button class="btn btn-primary btn-sm" onclick="updatePost(<?= $value['id']; ?>)">Save</button>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <div class="position-fixed bottom-0 end-0 p-3" style="z-index: 9999">
        <div id="toastMsg" class="toast align-items-center text-white bg-success border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body" id="toastText">Post updated successfully!</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    </div>
    <script src="../bootstrap/dist/js/bootstrap.bundle.min.js"></script>

    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script>
        function updatePost(id) {
            let data = {
                id: id,
                post_title: $('#title-' + id).val(),
                post_name: $('#name-' + id).val(),
                post_date: $('#date-' + id).val(),
                post_status: $('#status-' + id).val(),
                menu_order: $('#order-' + id).val()
            };

            function showToast(message, success = true) {
                const toastEl = document.getElementById('toastMsg');
                const toastText = document.getElementById('toastText');
                toastText.textContent = message;
                toastEl.classList.remove('bg-success', 'bg-danger');
                toastEl.classList.add(success ? 'bg-success' : 'bg-danger');
                const toast = new bootstrap.Toast(toastEl);
                toast.show();
            }

            $.ajax({
                url: './api/update_post.php',
                type: 'POST',
                data: data,
                beforeSend: function() {
                    $('#row-' + id + ' button').text('Saving...').prop('disabled', true);
                },
                success: function(response) {
                    try {
                        const res = JSON.parse(response);
                        showToast(res.msg, res.success);
                    } catch (e) {
                        showToast('Unexpected response: ' + response, false);
                    }
                },
                error: function() {
                    showToast('Error updating post');
                },
                complete: function() {
                    $('#row-' + id + ' button').text('Save').prop('disabled', false);
                }
            });
        }
    </script>

</body>

</html>