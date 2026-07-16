/* Login page logic */
(() => {
    'use strict';

    const form = document.getElementById('login-form');
    const alertBox = document.getElementById('alert');
    const submitBtn = document.getElementById('submit-btn');
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('toggle-password');

    function showAlert(message, type = 'danger') {
        alertBox.textContent = message;
        alertBox.className = 'alert alert-' + type;
        alertBox.hidden = false;
    }

    toggleBtn.addEventListener('click', () => {
        const showing = passwordInput.type === 'text';
        passwordInput.type = showing ? 'password' : 'text';
        toggleBtn.textContent = showing ? 'Show' : 'Hide';
        toggleBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        passwordInput.focus();
    });

    /* Session check: already logged in → dashboard; otherwise grab a CSRF token. */
    (async () => {
        if (new URLSearchParams(window.location.search).has('expired')) {
            showAlert('Your session has expired. Please sign in again.', 'warning');
        }
        try {
            const session = await Api.get('session');
            Api.setCsrf(session.csrf);
            if (session.authenticated) {
                window.location.replace('./');
            }
        } catch (e) {
            showAlert(e.message);
        }
    })();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = passwordInput.value;
        if (!username || !password) {
            showAlert('Please enter both username and password.');
            return;
        }

        submitBtn.classList.add('is-busy');
        submitBtn.disabled = true;
        alertBox.hidden = true;

        try {
            const result = await Api.post('login', { username, password });
            Api.setCsrf(result.csrf);
            window.location.replace('./');
        } catch (e) {
            showAlert(e.message, e.status === 429 ? 'warning' : 'danger');
            submitBtn.classList.remove('is-busy');
            submitBtn.disabled = false;
            passwordInput.value = '';
            passwordInput.focus();
        }
    });
})();
