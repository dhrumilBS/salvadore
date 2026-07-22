<?php
header('Content-Type: application/json');
$res = [];

function helper(int $n)
{
    $belowTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    $tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    if ($n == 0)
        $v = '';
    elseif ($n < 20)
        $v = $belowTwenty[$n] . " ";
    elseif ($n < 100)
        $v = $tens[intdiv($n, 10)] . " " . helper($n % 10);
    else
        $v = $belowTwenty[intdiv($n, 100)] . " hundred " . helper($n % 100);
    return $v;
}

function numberToWords(int $num)
{
    if ($num == 0)
        return "zero";

    // Indian system: first group is 3 digits (hundreds),
    // every group after that is 2 digits (thousand, lakh, crore, ...)
    $scales = ["Thousand", "Lakh", "Crore", "Arab", "Kharab", "Neel", "Padma", "Shankh"];

    $word = helper($num % 1000);
    $num = intdiv($num, 1000);

    $i = 0;
    while ($num > 0 && $i < count($scales)) {
        $group = $num % 100;
        if ($group != 0) {
            $word = helper($group) . $scales[$i] . " " . $word;
        }
        $num = intdiv($num, 100);
        $i++;
    }
    return trim($word);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = $_POST['number'] ?? '';
    $clean = str_replace(",", "", trim($raw));

    if ($clean === '' || !ctype_digit($clean)) {
        http_response_code(400);
        $res = ["success" => false, "msg" => "<em> " . htmlspecialchars($raw) . " </em> is not a number", "number" => $raw];
    } else {
        $num = (int) $clean;
        $word = numberToWords($num);

        http_response_code(200);
        $res = ["success" => true, "number" => $num, "word" => $word, "msg" => "Number converted successfully"];
    }
} else {
    http_response_code(405);
    $res = ["success" => false, "msg" => "Invalid request method"];
}

echo json_encode($res);
