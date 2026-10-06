<!doctype html>
<html lang="en">

<head>
	<meta charset="utf-8">
	<!-- Always force latest IE rendering engine or request Chrome Frame -->
	<meta content="IE=edge,chrome=1" http-equiv="X-UA-Compatible">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta name="color-scheme" content="light dark">
	<title>Salvadore &middot; Folder Manager</title>
	<link href="/dashboard/images/favicon.png" rel="icon" type="image/png" />
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
	<link href="../assets/site.css" rel="stylesheet">
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.css">
	<link rel="stylesheet" href="css/index.css">

</head>

<body class="index">

	<header class="header contain-to-grid">
		<div class="container">
			<nav class="top-bar" data-topbar>
				<ul class="title-area">
					<li class="name">
						<h1><a href="/dashboard/index.html"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
										<path d="M4 4l16 16M20 4L4 20" />
									</svg></span>Apache Friends</a></h1>
					</li>
					<li class="toggle-topbar menu-icon">
						<a href="#" class="btn btn-icon" aria-label="Toggle menu" aria-expanded="false">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
								<path d="M4 7h16M4 12h16M4 17h16" />
							</svg>
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
					<ul class="right">
						<li class="item "><button id="themeToggle" class="btn btn-icon" type="button" aria-label="Toggle dark mode" title="Toggle dark mode"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
								</svg></button></li>
					</ul>
				</section>
			</nav>
		</div>
	</header>

	<div class="wrapper">
		<div class="container hero-wrap">
			<div class="hero">
				<div class="row">
					<div class="large-12 columns">
						<h1>📂 Salvadore <span>Folder &amp; File Manager</span></h1>
					</div>
					<div class="large-12 columns">
						<h2>Create, browse, search, and delete project folders in this directory.</h2>
					</div>
				</div>
			</div>
		</div>

		<div class="container section">
			<div class="section-head">
				<div>
					<h3>Create folder</h3>
					<p>Adds a new folder right here, alongside the others.</p>
				</div>
			</div>

			<form id="createFolderForm" class="panel db-list" action="#" method="post">
				<div class="db-toolbar" style="border-bottom:0; margin-bottom:0; padding-bottom:0;">
					<input type="hidden" name="process" value="createFolder" />
					<label class="search" style="flex:1">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
							<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						</svg>
						<input type="text" name="folderName" id="folderName" placeholder="New folder name" aria-label="New folder name">
					</label>
					<button type="submit" id="createFolderBtn" class="btn btn-primary">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
							<path d="M12 5v14M5 12h14" />
						</svg>Create Folder</button>
				</div>
			</form>
		</div>

		<div class="container section">
			<div class="section-head">
				<div>
					<h3>Files &amp; folders</h3>
					<p>Select folders to delete, or search to filter the list.</p>
				</div>
				<form id="searchForm" action="#" method="post">
					<label class="search">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
							<circle cx="11" cy="11" r="7" />
							<path d="M20 20l-3.5-3.5" />
						</svg>
						<input type="search" id="searchInput" placeholder="Search folders and files" aria-label="Search folders and files">
					</label>
				</form>
			</div>

			<form id="deleteFolder" class="deleteFolder">
				<div class="db-toolbar">
					<div id="responseMessage"></div>
					<input type="submit" id="submitDeleteFolders" class="btn btn-danger" value="Delete Folders">
				</div>

				<div class="row file-grid" id="fileGrid">
					<?php
					$contents = scandir('.');
					foreach ($contents as $item) {
						if ($item !== '.' && $item !== '..') {
							$isDir = is_dir('./' . $item);
							$safe = htmlspecialchars($item, ENT_QUOTES);
							?>
							<div class="file-card dir_item" data-dirname="<?= strtolower($safe) ?>">
								<?php if ($isDir) { ?>
									<input type="checkbox" name="inputCheckbox[]" class="inputCheckbox" id="del_<?= $safe ?>" value="<?= $safe ?>">
								<?php } ?>
								<span class="file-ico <?= $isDir ? 'dir' : '' ?>">
									<?php if ($isDir) { ?>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
										</svg>
									<?php } else { ?>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
											<path d="M14 3v5h5" />
										</svg>
									<?php } ?>
								</span>
								<a href="./<?= $safe ?>" target="_blank" style="min-width:0">
									<h1 class="large-4 columns"> <?= $safe ?></h1>
									<small><?= $isDir ? 'Folder' : 'File' ?></small>
								</a>
							</div>
							<?php
						}
					}
					?>
				</div>
				<p class="empty" id="fileEmpty" hidden>No files or folders match your filter.</p>
			</form>
		</div>

		<footer class="footer container">Salvadore &middot; Folder Manager</footer>
	</div>

	<!-- JS Libraries -->
	<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.js"></script>
	<script src="../assets/site.js"></script>
	<script src="css/script.js"></script>
</body>

</html>
