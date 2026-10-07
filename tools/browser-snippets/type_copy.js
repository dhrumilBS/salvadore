// Type anywhere on the page (not inside a form field) and press Enter to copy
// what you typed. Type "me" + Enter to list everything copied so far.
// Keys typed in inputs are ignored and nothing is saved in cookies.
(() => {
	const copy = t => navigator.clipboard?.writeText(t) ?? new Promise((ok, no) => { const a = Object.assign(document.createElement('textarea'), { value: t }); document.body.append(a); a.select(); const r = document.execCommand('copy'); a.remove(); r ? ok() : no(); }); // http pages have no Clipboard API
	if (window.__typeCopy) return console.log('Type-to-copy is already running.');
	window.__typeCopy = true;
	let buf = '';
	const history = [];
	const isField = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

	window.addEventListener('keydown', e => {
		if (isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Escape') { buf = ''; return; }
		if (e.key === 'Backspace') { buf = buf.slice(0, -1); return; }
		if (e.key !== 'Enter') {
			if (e.key.length === 1) buf += e.key;
			return;
		}
		const text = buf;
		buf = '';
		if (!text) return;
		if (text === 'me') return console.table(history);
		history.push(text);
		copy(text).then(
			() => console.log(`Copied: ${text}`),
			() => console.warn(`Could not copy "${text}" - click the page first.`)
		);
	});
	console.log('Type-to-copy on: type, then Enter. "me" + Enter lists history, Esc clears.');
})();
