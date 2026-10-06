var bodyClassList = document.body.classList;
var pageId = null;
for (var i = 0; i < bodyClassList.length; i++) {
	if (bodyClassList[i].startsWith('page-id-')) {
		pageId = bodyClassList[i].substring('page-id-'.length);
		if (pageId) {
			var link = document.createElement('a');
			link.classList.add('wp-page-id-btn');
			link.href = '/wp-admin/post.php?post=' + pageId + '&action=elementor';
			link.textContent = 'Edit';
			copyCode(pageId);
			document.body.appendChild(link);
		}
		break;
	}
	if (bodyClassList[i].startsWith('postid-')) {
		postId = bodyClassList[i].substring('postid-'.length);
		if (postId) {
			var link = document.createElement('a');
			link.classList.add('wp-page-id-btn');
			link.href = '/wp-admin/post.php?post=' + postId + '&action=edit';
			link.textContent = 'Edit';
			copyCode(postId);
			document.body.appendChild(link);
		}
		break;
	}
}

function copyCode(Text) {
	console.log(Text);
	var textToCopy = Text;
	var tempInput = document.createElement('input');
	tempInput.value = textToCopy;
	document.body.appendChild(tempInput);
	tempInput.select();
	document.execCommand('copy');
	document.body.removeChild(tempInput);
}