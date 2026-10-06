<?php
header("Content-Type: application/json");
date_default_timezone_set("Asia/Kolkata");

$file = __DIR__ . "/remarks.json";
if (file_exists($file)) {
    $remarks = json_decode(file_get_contents($file), true);
} else {
    $remarks = [];
}

$id     = $_POST["id"] ?? null;
$remark = $_POST["remark"] ?? "";
$title  = $_POST["title"] ?? "";

if (!$id) {
    echo json_encode(["success" => false, "error" => "Invalid ID"]);
    exit;
}

function uaDetect()
{
    $ua = $_SERVER['HTTP_USER_AGENT'];

    // Device
    $device = preg_match('/mobile/i', $ua) ? 'Mobile' : (preg_match('/tablet|ipad/i', $ua) ? 'Tablet' : 'Desktop');

    // OS + Version
    $os =
        (preg_match('/Windows NT ([0-9\.]+)/i', $ua, $m) ? "Windows $m[1]" : (preg_match('/Android ([0-9\.]+)/i', $ua, $m) ? "Android $m[1]" : (preg_match('/Mac OS X ([0-9_]+)/i', $ua, $m) ? "macOS " . str_replace('_', '.', $m[1]) : (preg_match('/CPU (?:iPhone|OS|iPad) ([0-9_]+)/i', $ua, $m) ? "iOS " . str_replace('_', '.', $m[1]) :
                        "Unknown OS"))));

    // Browser + Version
    $browser =
        (preg_match('/Chrome\/([0-9\.]+)/i', $ua, $m) ? "Chrome $m[1]" : (preg_match('/Firefox\/([0-9\.]+)/i', $ua, $m) ? "Firefox $m[1]" : (preg_match('/Version\/([0-9\.]+).*Safari/i', $ua, $m) ? "Safari $m[1]" : (preg_match('/Edg\/([0-9\.]+)/i', $ua, $m) ? "Edge $m[1]" :
                        "Unknown Browser"))));

    return "$device | $os | $browser";
}





$ip        = $_SERVER['REMOTE_ADDR'] ?? 'UNKNOWN';
$device    = uaDetect();
$timestamp = date("Y-m-d H:i:s");

if (!isset($remarks[$id])) {
    $remarks[$id] = [
        "title"     => $title,
        "remark"    => $remark,
        "ip"        => $ip,
        "device"    => $device,
        "timestamp" => $timestamp,
        "history"   => []  // NEW HISTORY ARRAY
    ];
} else {
    // Add OLD remark to history (if exists)
    if (!empty($remarks[$id]["remark"])) {
        array_unshift($remarks[$id]["history"], [
            "remark"    => $remarks[$id]["remark"],
            "ip"        => $remarks[$id]["ip"],
            "device"    => $remarks[$id]["device"],
            "timestamp" => $remarks[$id]["timestamp"]
        ]);
    }

    // Update with new values
    $remarks[$id]["title"]     = $title;
    $remarks[$id]["remark"]    = $remark;
    $remarks[$id]["ip"]        = $ip;
    $remarks[$id]["device"]    = $device;
    $remarks[$id]["timestamp"] = $timestamp;
}

file_put_contents($file, json_encode($remarks, JSON_PRETTY_PRINT));

echo json_encode(["success" => true]);
