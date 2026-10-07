// HRMS login - fills the sign-in form and submits.
// Credentials are NOT stored here (this folder is public). Put them only in
// your own copy of this snippet in DevTools > Sources > Snippets.
(() => {
	const EMAIL = ''; // your HRMS email
	const PASS = '';  // your HRMS password
	if (!EMAIL || !PASS) return alert('Fill EMAIL and PASS in your local DevTools copy of this snippet first.');
	const email = document.querySelector('.signin-email');
	const pass = document.querySelector('.signin-password');
	if (!email || !pass) return alert('No HRMS sign-in form on this page.');
	// Set values the way a framework-driven form notices them.
	for (const [el, v] of [[email, EMAIL], [pass, PASS]]) {
		el.value = v;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}
	document.getElementById('loginbtn').click();
})();
