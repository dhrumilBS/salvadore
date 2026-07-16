<!doctype html>
<html lang="en">

<head>
	<meta charset="utf-8">
	<!-- Always force latest IE rendering engine or request Chrome Frame -->
	<meta content="IE=edge,chrome=1" http-equiv="X-UA-Compatible">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />

	<!-- Use title if it's in the page YAML frontmatter -->
	<title>Welcome to XAMPP</title>

	<meta name="description" content="XAMPP is an easy to install Apache distribution containing MariaDB, PHP and Perl." />
	<meta name="keywords" content="xampp, apache, php, perl, mariadb, open source distribution" />

	<link href="/dashboard/stylesheets/all.css" rel="stylesheet" type="text/css" />
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.css">
	<link href="/dashboard/images/favicon.png" rel="icon" type="image/png" />
	<link rel="stylesheet" href="css/index.css">


</head>

<body class="index">
	<header class="header contain-to-grid">
		<nav class="top-bar" data-topbar>
			<ul class="title-area">
				<li class="name">
					<h1><a href="/dashboard/index.html">Apache Friends</a></h1>
				</li>
				<li class="toggle-topbar menu-icon">
					<a href="#">
						<span>Menu</span>
					</a>
				</li>
			</ul>

			<section class="top-bar-section">
				<!-- Left Nav Section -->
				<ul class="left">
					<li class="item "><a href="/dashboard/faq.html">FAQs</a></li>
					<li class="item "><a href="/dashboard/howto.html">HOW-TO Guides</a></li>
					<li class="item "><a target="_blank" href="/dashboard/phpinfo.php">PHPInfo</a></li>
					<li class="item "><a href="/phpmyadmin/">phpMyAdmin</a></li>
				</ul>


			</section>
		</nav>
	</header>
	<div class="wrapper">
		<div class="hero">
			<div class="row">
				<div class="large-12 columns">
					<h1><img src="/dashboard/images/xampp-logo.svg" />XAMPP <span>Apache + MariaDB + PHP + Perl</span></h1>
				</div>
			</div>
		</div>

		<div class="hero create-folder-div">
			<div class="row">
				<div class="large-6 columns">
					<form id="createFolderForm" action="#" method="post">
						<div class="create-folder">
							<input type="hidden" name="process" value="createFolder" class="input-field" />
							<input type="text" name="folderName" class="input-field" />
							<input type="submit" id="createFolderBtn" value="Create Folder" />
						</div>
					</form>
				</div>
			</div>
		</div>
		<div class="hero">
			<div class="row">
				<div class="large-12 columns">
					<form action="#" method="post" id="searchForm">
						<input type="text" id="searchInput" placeholder="Search for a folder...">
					</form>
				</div>
			</div>

			<div class="dir_list">
				<form id="deleteFolder" class="deleteFolder" method="POST">

					<div class="row">
						<div class='large-4 columns'>
							<div id="responseMessage"></div>
							<input type="submit" value="Delete Folders">
						</div>
					</div>

					<div class="row">
						<?php
						$contents = scandir('.');
						foreach ($contents as $item) {
							if ($item !== '.' && $item !== '..') {
								$fullPath = './' . $item;
								echo "<div class='large-4 columns dir_item' data-dirname='$item'><h1 class='folder'> <input type='checkbox' name='inputCheckbox[]' class='inputCheckbox' value='$item' /> <a href='./$item' target='_blank'> 📁 $item </a></h1></div>";
							}
						}
						?>

					</div>
				</form>
			</div>
		</div>
	</div>


	<!-- JS Libraries -->
	<script src="//code.jquery.com/jquery-3.6.4.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.js"></script>
	<script src="css/script.js"></script>
</body>

</html>