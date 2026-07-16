var s = '';
var str = [];
var i = 1;
window.addEventListener('keypress', function (event) {
	if (event.key == 'Enter') {
		i++;
		if (s == 'me') {
			alert(str);
		} else if (s == '1') {
			const username = getCookie('username');
			if (username) {
				console.log('Cookie Username: ' + username);
			} else {
				console.log('Username cookie not found');
			}
			s = '';
		} else {
			str.push(s);
			document.cookie = 'username=' + s;
		}
		copyCode(s);
		s = '';
	} else {
		s = s + event.key;
	}
});
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

function getCookie(cookieName) {
	const name = cookieName + '=';
	const decodedCookie = decodeURIComponent(document.cookie);
	const cookieArray = decodedCookie.split(';');

	for (let i = 0; i < cookieArray.length; i++) {
		let cookie = cookieArray[i].trim();
		if (cookie.indexOf(name) === 0) {
			return cookie.substring(name.length, cookie.length);
		}
	}
	return null;
}
