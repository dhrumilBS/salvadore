<?php
header('Content-Type: application/json');
$res = [];
$thousands = ["", "Thousand", "Lack", "Crore", "Arab", "Kharab", "Niyut", "Padma", "Shankh", "Vardhaman"];
function helper($n)
{
    $belowTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    $tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    if ($n === 0)
        $v  = '';
    elseif ($n < 20)
        $v  = $belowTwenty[$n] . " ";
    elseif ($n < 100)
        $v  = $tens[floor($n / 100)] . " " . helper($n % 10);
    elseif ($n < 1000)
        $v  = $belowTwenty[floor($n / 100)] . " hundred " . helper($n % 100);
    return $v;
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $num = $_POST['number'] ?? null;
    if (empty($_POST) || !isset($num)) {
        http_response_code(400);
        $res = ["success" => false, "msg" => "<em> $num </em> is Not number", "number" => $num ?? null];
    } else {
        $word = "";
        $i = 0;
        $num = intval(str_replace(",", "", (int) $_POST['number']));
        while ($num >  0) {
            if ($num % 1000 !== 0) {
                $word = helper($num % 1000) . $thousands[$i] . " " . $word;
            }
            $num = floor($num / 1000);
            $i++;
        }
        $word  = trim($word);

        http_response_code(200);
        $res = ["success" => true, "number" =>  (int) $_POST['number'], "word" => $word ?? '', "msg" => "Number converted successfully"];
    }
} else {
    http_response_code(405);
    $res = ["success" => false, "msg" => "Invalid request method"];
}

echo json_encode($res);
