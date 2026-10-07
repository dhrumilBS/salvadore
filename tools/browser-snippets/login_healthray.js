// Healthray WP login - fills wp-login.php and submits.
// Credentials are NOT stored here (this folder is public). Put them only in
// your own copy of this snippet in DevTools > Sources > Snippets.
(() => {
	const USER = ''; // your WordPress username
	const PASS = ''; // your WordPress password
	if (!USER || !PASS) return alert('Fill USER and PASS in your local DevTools copy of this snippet first.');
	const user = document.getElementById('user_login');
	const pass = document.getElementById('user_pass');
	if (!user || !pass) return alert('No WordPress login form on this page.');
	user.value = USER;
	pass.value = PASS;
	document.getElementById('wp-submit').click();
})();
