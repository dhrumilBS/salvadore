/**
 * Tiny API client. Extensionless endpoints ("api/session"), CSRF header on
 * every POST, JSON in/out, automatic redirect to /login on expired sessions.
 */
const Api = (() => {
    'use strict';

    let csrfToken = '';
    const onLoginPage = /\/login(?:\.html)?\/?$/.test(window.location.pathname);

    function setCsrf(token) {
        if (typeof token === 'string' && token) csrfToken = token;
    }

    function url(path, params) {
        const u = new URL('api/' + path, window.location.href);
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
            });
        }
        return u.toString();
    }

    async function request(path, { method = 'GET', params = null, body = null } = {}) {
        const options = {
            method,
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin',
        };
        if (body !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['X-CSRF-Token'] = csrfToken;
            options.body = JSON.stringify(body);
        }

        let res;
        try {
            res = await fetch(url(path, params), options);
        } catch (e) {
            throw new ApiError('Network error - is Apache running?', 0);
        }

        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON response */ }

        if (res.status === 401 && !onLoginPage) {
            window.location.replace('login?expired=1');
            throw new ApiError('Session expired.', 401, data);
        }

        if (!res.ok || (data && data.success === false)) {
            const message = (data && data.message) || `Request failed (HTTP ${res.status}).`;
            throw new ApiError(message, res.status, data);
        }
        if (data === null) {
            throw new ApiError('Unexpected non-JSON response from the server.', res.status);
        }
        return data;
    }

    class ApiError extends Error {
        constructor(message, status, data = null) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.data = data;
        }
    }

    return {
        setCsrf,
        ApiError,
        get: (path, params) => request(path, { params }),
        post: (path, body, params) => request(path, { method: 'POST', body: body || {}, params }),
    };
})();
