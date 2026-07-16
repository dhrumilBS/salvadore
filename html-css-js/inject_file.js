
// Immediately-invoked function expression
(function ($) {
	'use strict';
	function addScript(filename) {
		$('head').append(
			'<script src="' + filename + '" type="text/javascript"></script>'
		);
	}

	function addCSS(filename) {
		$('head').append(
			'<link href="' + filename + '" rel="stylesheet" type="text/css">'
		);
	}

	var link = 'http://127.0.0.1:8080';
	// Loading files
	addScript(link + '/xyz/script.js');
	addCSS(link + '/xyz/style.css');
})(jQuery);
