// Loads a local script + stylesheet into the current page, for testing
// changes before uploading them. Set BASE to your local dev server.
// Note: an https:// site blocks http:// files (mixed content) - serve your
// files over https or test on an http:// copy of the site.
(() => {
	const BASE = 'http://127.0.0.1:8080/xyz';
	const FILES = ['script.js', 'style.css'];
	const bust = `?v=${Date.now()}`; // always the latest version, never the cached one

	for (const f of FILES) {
		const el = f.endsWith('.css')
			? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${BASE}/${f}${bust}` })
			: Object.assign(document.createElement('script'), { src: `${BASE}/${f}${bust}` });
		el.onload = () => console.log(`Loaded ${f}`);
		el.onerror = () => console.error(`Could not load ${BASE}/${f} - is the server running? (https pages can't load http files)`);
		document.head.appendChild(el);
	}
})();
