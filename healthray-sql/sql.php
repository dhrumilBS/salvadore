<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';



echo "SELECT * from wp_postmeta WHERE meta_key = \"_yoast_wpseo_canonical\";";