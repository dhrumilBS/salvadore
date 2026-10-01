<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';


$find = '1,000';
$replace = '1000';
$qun = [];
$lastQuery = "";

// Function to highlight found keywords
function highlightKeyword($text, $keyword)
{
    $bgcolors = ["purple", "lightblue", "lightgreen", "pink", "orange"];
    $colors = ["white", "black", "black", "black", "black"];

    preg_match_all('/((?:\S+\s+){0,5})(' . preg_quote($keyword, '/') . ')((?:\s+\S+){0,5})/i', strip_tags($text), $matches, PREG_SET_ORDER);

    $highlightedTexts = [];
    foreach ($matches as $index => $match) {
        $bgcolor = $bgcolors[$index % count($bgcolors)];
        $color = $colors[$index % count($colors)];

        $highlightedTexts[] = "<span>{$match[1]} 
        <strong style='background-color: $bgcolor; color: $color; padding: 2px;'>{$match[2]}</strong> 
        {$match[3]}</span>";
    }
    return implode(" ", $highlightedTexts);
}

// Fetch records where the find word exists
$q = "SELECT * FROM wp_postmeta WHERE meta_value LIKE '%$find%'";
$query = $conn->query($q);
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Find & Replace Results</title>
    <link rel="stylesheet" href="../bootstrap/dist/css/bootstrap.css">
    <style>
        .highlighted {
            font-size: 16px;
        }

        .query-box {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
            margin-top: 15px;
        }

        .copy-btn {
            float: right;
            margin-top: -5px;
        }
    </style>
</head>

<body>
    <div class="container my-3">
        <h3 class="mb-3">Find & Replace Results</h3>

        <div class="alert alert-info">
            <strong>Find:</strong> <?= $find; ?><br>
            <strong>Replace With:</strong> <?= $replace; ?>
        </div>

        <p>Found <span class="badge bg-primary"><?= $query->num_rows; ?></span> occurrences</p>

        <table class="table table-bordered">
            <thead>
                <tr>
                    <th>Meta ID</th>
                    <th>Post ID</th>
                    <th>Meta Key</th>
                    <th>Highlighted Content</th>
                </tr>
            </thead>
            <tbody>
                <?php while ($row = $query->fetch_assoc()):
                    $updateQuery = "UPDATE wp_postmeta SET meta_value = replace(meta_value, '$find', '$replace') WHERE meta_value LIKE '%$find%'";
                    $qun[] = $updateQuery;

                ?>
                    <tr>
                        <td><?= $row['meta_id']; ?></td>
                        <td><?= $row['post_id']; ?></td>
                        <td><?= $row['meta_key']; ?></td>
                        <td><?= highlightKeyword($row['meta_value'], $find); ?></td>
                    </tr>
                <?php endwhile; ?>
            </tbody>
        </table>

        <?php if (!empty($qun)): ?>
            <div class="query-box">
                <button class="btn btn-sm btn-primary copy-btn" onclick="copyToClipboard('#lastQuery')">Copy Query</button>
                <strong>Select Query:</strong>
                <pre id="lastQuery"><?= $q; ?></pre>
            </div>

            <div class="query-box">
                <button class="btn btn-sm btn-primary copy-btn" onclick="copyToClipboard('#allQueries')">Copy Query</button>
                <strong>All Queries:</strong>
                <pre id="allQueries"><?= implode(";\n", $qun); ?></pre>
            </div>
        <?php endif; ?>

    </div>

    <script>
        function copyToClipboard(element) {
            var textToCopy = document.querySelector(element).innerText;
            var tempInput = document.createElement('input');
            tempInput.value = textToCopy;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
        }
    </script>

</body>

</html>