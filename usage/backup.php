<?php
/*
 * Copies the usage log to the folder in backup-dir.txt (a OneDrive / network
 * folder, so a copy exists off this PC) and records an "anchor": how many
 * entries the log had and the newest signature. The report checks the log
 * still contains the latest anchor, so entries cut off the end are caught.
 *
 * Runs hourly from Task Scheduler ("Salvadore usage backup", via `conhost --headless` so no window flashes):
 *   D:\xampp\php\php.exe D:\xampp\htdocs\salvadore\usage\backup.php
 * Refuses to back up a log that fails its check, so a good copy is never
 * overwritten by a tampered one. The HMAC key is NOT copied.
 */
require __DIR__ . '/lib.php';
usage_require_cli();

$say = function (string $msg): void {
    $line = date('Y-m-d H:i:s T') . "  $msg\n";
    file_put_contents(usage_dir() . '/backup.log', $line, FILE_APPEND);
    echo $line;
};

$dest = usage_backup_dir();
if (!$dest) {
    $say('Not set up: put the backup folder path in ' . usage_dir() . DIRECTORY_SEPARATOR . 'backup-dir.txt');
    exit(1);
}
if (!is_dir($dest) && !mkdir($dest, 0700, true)) {
    $say("Can't create $dest");
    exit(1);
}

exit(usage_locked(function () use ($dest, $say) {
    $check = usage_read(PHP_INT_MAX, fn() => null);
    if (!$check['ok']) {
        $say('REFUSED: the log fails its check (' . json_encode($check['broken'] ?? $check['backup']) . ') - backup left as it was');
        return 2;
    }
    foreach (usage_files() as $file) {
        $to = $dest . DIRECTORY_SEPARATOR . basename($file);
        if (!is_file($to) || filesize($to) !== filesize($file)) {
            copy($file, $to);
        }
    }
    $last = usage_last_anchor();
    if (!$last || $last['entries'] !== $check['entries']) {
        $anchor = ['t' => time(), 'entries' => $check['entries'], 'hash' => usage_last_hash()];
        file_put_contents($dest . DIRECTORY_SEPARATOR . 'anchors.log', json_encode($anchor) . "\n", FILE_APPEND);
    }
    $say("OK: {$check['entries']} entries -> $dest");
    return 0;
}));
