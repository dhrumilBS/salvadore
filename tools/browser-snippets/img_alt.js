document.addEventListener('DOMContentLoaded', function () {
	var images = document.getElementsByTagName('img');
	for (var i = 0; i < images.length; i++) {
		var img = images[i].alt;
		if (!img) console.log(img ? undefined : images[i]);
	}
});
