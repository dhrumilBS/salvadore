$(document).ready(function () {
	let body = $('#top');
	const removedSections = {};

	const btnWrap = $(
		'<div class="d-flex gap-3 py-2 px-1 bg-dark shadow-lg btn-grp"></div>'
	);

	// Create buttons dynamically
	for (let i = 1; i <= 11; i++) {
		let btn = $(
			`<button class="bs-btn btn-${i}" data-section="av_section_${i}">Section ${i}</button>`
		);
		btnWrap.append(btn);
	}
	btnWrap.append(
		`<button class="bs-btn btn-header" data-section="header">Header</button>`
	);
	btnWrap.append(
		`<button class="bs-btn btn-form-review" data-section="form-review">Form Review</button>`
	);
	btnWrap.append(
		`<button class="bs-btn btn-footer" data-section="footer">Footer</button>`
	);

	body.prepend(btnWrap);
	body.on('click', '.bs-btn', function () {
		let sectionId = $(this).data('section');
		let sectionEl = $(`#${sectionId}`);
		console.log(sectionId);
		if (removedSections[sectionId]) {
			console.log('removedSections', removedSections);
			$('#main').append(removedSections[sectionId]);
			delete removedSections[sectionId];
			$(this).removeClass('removed-btn');
		} else {
			if (sectionEl.length) {
				console.log('removedSections Not----', removedSections);

				removedSections[sectionId] = sectionEl.detach(); // detach keeps data + events
				$(this).addClass('removed-btn');
			}
		}
	});

	$('#dotnetPopup').remove();
	$('#net-au-css').remove();

	var link = 'http://127.0.0.1:8080';
	function addScript(filename) {
		jQuery('head').append(
			'<script src="' + filename + '" type="text/javascript"></script>'
		);
	}

	function addCSS(filename) {
		jQuery('head').append(
			'<link href="' +
				filename +
				'" rel="stylesheet" type="text/css" id="inject-style">'
		);
	}
	console.clear(jQuery('head'));
	setTimeout(function () {
		// addScript(link + '/healthray/script.js');
		addCSS(link + '/style.css');
	}, 300);
});
