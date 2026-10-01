<pre><?php

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';


$sql = "SELECT ID, post_type, post_status, post_title,
  (
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1,000 hospital', ''))) / LENGTH('1,000 hospital')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1000 hospital', ''))) / LENGTH('1000 hospital')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1000+ hospital', ''))) / LENGTH('1000+ hospital')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1,000+ hospital', ''))) / LENGTH('1,000+ hospital')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1000 clinic', ''))) / LENGTH('1000 clinic')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1,000 clinic', ''))) / LENGTH('1,000 clinic')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1000+ clinic', ''))) / LENGTH('1000+ clinic')
    +
    (LENGTH(LOWER(post_content)) - LENGTH(REPLACE(LOWER(post_content), '1,000+ clinic', ''))) / LENGTH('1,000+ clinic')
  ) AS total_occurrences
FROM wp_posts
WHERE post_type IN ('post', 'page')
  AND post_status = 'publish'
  AND (
    LOWER(post_content) LIKE '%1,000 hospital%'
    OR LOWER(post_content) LIKE '%1000 hospital%'
    OR LOWER(post_content) LIKE '%1000+ hospital%'
    OR LOWER(post_content) LIKE '%1,000+ hospital%'
    OR LOWER(post_content) LIKE '%1000 clinic%'
    OR LOWER(post_content) LIKE '%1,000 clinic%'
    OR LOWER(post_content) LIKE '%1000+ clinic%'
    OR LOWER(post_content) LIKE '%1,000+ clinic%'
  )
ORDER BY total_occurrences DESC;";
$query = $conn->query($sql);
$data = [];
while ($row = $query->fetch_assoc()) {
  $data[] = $row;
}

print_r($data);
