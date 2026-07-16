<?php

$site =  $_POST['site_url'];
$savepath =  $_POST['path_to_save'];
$res = [];

$array = [];
function imgHTML($url, $message, $color, $borderColor)
{
    return "<div class='float-start'> 
                <div class='card card-body m-2' style='background-color: $color; border:1px solid $borderColor'> 
                    <div class='d-flex flex-column'> 
                        <p> $message: $url</p>  
                        <img src='$url' width='150' height='150' style='object-fit:contain;'> 
                    </div> 
                </div> 
            </div>";
}

$s = 260;
$h = 250;

if (isset($_FILES['imgFile']) && $_FILES['imgFile']['error'] === 0) {
    $fileTmpPath = $_FILES['imgFile']['tmp_name'];
    $fileContents = file_get_contents($fileTmpPath);

    $jsonData = json_decode($fileContents, true);
    $imgs = $jsonData;
    foreach ($imgs as $img) {
        $url = $site . $img;
        $imgPath = explode('/', $img);
        $path = "./arrigo/$imgPath[0]/$imgPath[1]/$imgPath[2]/";
        $file_path = $path . $imgPath[3];

        $h++;
        $s++;

        $color = "hsl($h, 100%, 93%)";
        $borderColor = "hsl($s,70%, 54%)";

        if (file_exists($file_path)) {
            echo imgHTML($file_path, 'File already exists', $color, $borderColor);
            flush();
            continue;
        }
        if (!is_dir($path)) {
            mkdir($path, 0777, true);
        }
        $image_data = file_get_contents($url);
        if ($image_data === false) {
            echo "<p>Error: Could not download image from $url</p>";
            flush();
            continue;
        }
        if (file_put_contents($file_path, $image_data) !== false) {
            echo imgHTML($file_path, 'Image saved', $color, $borderColor);
        } else {
            echo "<p>Error: Could not save image to $file_path</p>";
        }

        flush();
    }
}
