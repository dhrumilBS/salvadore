<?php
header("Content-Type: text/html");
ob_implicit_flush(true);
ob_end_flush();

function randomeCOLOR($h, $s, $l)
{
    return "hsl($h" . "deg, $s%, $l%)";
}


$site = 'https://artemsemkin.com/arrigo/html/';
$savepath = '/arrigo/';

$imgs = [
    "img/assets/sectionPortfolio/item-1.jpg",
    "img/assets/sectionPortfolio/item-2.jpg",
    "img/assets/sectionPortfolio/item-3.jpg",
    "img/assets/sectionPortfolio/item-4.jpg",
    "img/assets/sectionPortfolio/item-5.jpg",
    "img/assets/sectionPortfolio/item-2.jpg",
    "img/assets/sectionPortfolio/item-3.jpg",
    "img/assets/sectionPortfolio/item-4.jpg",
    "img/assets/sectionPortfolio/item-6.jpg",

    "img/assets/avatars/avatar-1.jpg",
    "img/assets/avatars/avatar-2.jpg",
    "img/assets/avatars/avatar-3.jpg",
    "img/assets/avatars/avatar-4.jpg",

    "img/assets/sectionCTA/bg-1.jpg",
    "img/assets/sectionCTA/bg-3.jpg",
    "img/assets/sectionCTA/bg-3.jpg",
    "img/assets/sectionCTA/bg-3.jpg",
    "img/assets/sectionCTA/bg-2.jpg",
    "img/assets/sectionCTA/bg-3.jpg",

    "img/assets/sectionLatestPosts/item-1.jpg",
    "img/assets/sectionLatestPosts/item-2.jpg",
    "img/assets/sectionLatestPosts/item-3.jpg",

    "img/assets/sectionFullscreen/slide_3-1.jpg",
    "img/assets/sectionFullscreen/slide_3-2.jpg",
    "img/assets/sectionFullscreen/slide_3-3.jpg",
    "img/assets/sectionFullscreen/slide_3-4.jpg",
    "img/assets/sectionFullscreen/slide_1-1.jpg",
    "img/assets/sectionFullscreen/slide_1-2.jpg",
    "img/assets/sectionFullscreen/slide_1-3.jpg",
    "img/assets/sectionFullscreen/slide_1-4.jpg",
    "img/assets/sectionFullscreen/slide_1-5.jpg",
    "img/assets/sectionFullscreen/slide_1-6.jpg",
    "img/assets/sectionFullscreen/slide_1-7.jpg",
    "img/assets/sectionFullscreen/slide_1-8.jpg",
    "img/assets/sectionFullscreen/slide_2-1.jpg",
    "img/assets/sectionFullscreen/slide_2-2.jpg",
    "img/assets/sectionFullscreen/slide_2-3.jpg",
    "img/assets/sectionFullscreen/slide_2-4.jpg",
    "img/assets/sectionFullscreen/slide_2-5.jpg",
    "img/assets/sectionFullscreen/slide_2-6.jpg",
    "img/assets/sectionFullscreen/slide_2-7.jpg",
    "img/assets/sectionFullscreen/slide_2-8.jpg",

    "img/assets/sectionSteps/img-1.jpg",
    "img/assets/sectionSteps/img-2.jpg",
    "img/assets/sectionSteps/img-3.jpg",

    "img/assets/sectionTeam/img-1.jpg",
    "img/assets/sectionTeam/img-2.jpg",
    "img/assets/sectionTeam/img-3.jpg",
    "img/assets/sectionTeam/img-4.jpg",
    "img/assets/sectionTeam/img-5.jpg",

    "img/assets/sectionLogos/logo-1.png",
    "img/assets/sectionLogos/logo-2.png",
    "img/assets/sectionLogos/logo-3.png",
    "img/assets/sectionLogos/logo-4.png",
    "img/assets/sectionLogos/logo-5.png",
    "img/assets/sectionLogos/logo-6.png",
    "img/assets/sectionLogos/logo-7.png",
    "img/assets/sectionLogos/logo-8.png",
    "img/assets/sectionLogos/logo-1.png",
    "img/assets/sectionLogos/logo-2.png",
    "img/assets/sectionLogos/logo-3.png",
    "img/assets/sectionLogos/logo-4.png",
    "img/assets/sectionLogos/logo-5.png",
    "img/assets/sectionLogos/logo-6.png",
    "img/assets/sectionLogos/logo-7.png",
    "img/assets/sectionLogos/logo-8.png",

    "img/assets/articlePortfolioDetails/item_1-1.jpg",
    "img/assets/articlePortfolioDetails/item_1-2.jpg",
    "img/assets/articlePortfolioDetails/item_1-3.jpg",
    "img/assets/articlePortfolioDetails/item_1-4.jpg",
    "img/assets/articlePortfolioDetails/item_1-5.jpg",

    "img/assets/sectionBlog/blog-preview-1.jpg",
    "img/assets/sectionBlog/blog-preview-2.jpg",
    "img/assets/sectionBlog/blog-preview-3.jpg",
    "img/assets/sectionBlog/blog-preview-4.jpg",

    "img/assets/sidebar/thumb-1.jpg",
    "img/assets/sidebar/thumb-2.jpg",
    "img/assets/sidebar/thumb-3.jpg",

    "img/assets/sectionInfo/bg.jpg",

];


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

foreach ($imgs as $img) {
    $url = $site . $img;
    $imgPath = explode('/', $img);
    $path = "./arrigo/$imgPath[0]/$imgPath[1]/$imgPath[2]/";
    $file_path = $path . $imgPath[3];


    $h++;
    $s++;

    $color = "hsl($h, 100%, 95%)";
    $borderColor = "hsl($s,70%, 55%)";

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
