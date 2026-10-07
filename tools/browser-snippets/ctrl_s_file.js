// WordPress admin helpers (run once per tab in wp-admin):
//   Ctrl/Cmd + S       save / update the post, page or settings form
//   Ctrl + Delete      delete the attachment open in the Media modal
//   click the Media "Title" field    turn "my-image-name" into "my image name" and copy it
//   double-click the Media "Title"   copy it as is
(() => {
	if (window.__wpAdminKeys) return console.log('wp-admin helpers already running.');
	window.__wpAdminKeys = true;
	const copy = t => navigator.clipboard?.writeText(t) ?? new Promise((ok, no) => { const a = Object.assign(document.createElement('textarea'), { value: t }); document.body.append(a); a.select(); const r = document.execCommand('copy'); a.remove(); r ? ok() : no(); }); // http pages have no Clipboard API
	const copyLog = text => copy(text).then(() => console.log(`Copied: ${text}`), () => {});

	// The Media modal is built after page load, so listen on the document.
	document.addEventListener('click', e => {
		const field = e.target.closest('#attachment-details-two-column-title, #attachment-details-title');
		if (!field || e.detail > 1) return;
		const tidy = field.value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
		if (tidy !== field.value) {
			field.value = tidy;
			field.dispatchEvent(new Event('change', { bubbles: true })); // so WordPress saves the new title
		}
		copyLog(tidy);
	});
	document.addEventListener('dblclick', e => {
		const field = e.target.closest('#attachment-details-two-column-title, #attachment-details-title');
		if (field) copyLog(field.value);
	});

	document.addEventListener('keydown', e => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			// Drafts: "Save draft" (never Publish). Published posts: "Update".
			const btn = ['.editor-post-save-draft', '#save-post', '.editor-post-publish-button', '#publish', '#submit']
				.map(s => document.querySelector(s)).find(Boolean);
			btn ? btn.click() : console.warn('No save button on this screen.');
		}
		if (e.ctrlKey && e.key === 'Delete') {
			const del = document.querySelector('.media-modal .delete-attachment, .delete-attachment');
			if (del) { e.preventDefault(); del.click(); }
		}
	});
	console.log('wp-admin helpers on: Ctrl+S saves, Ctrl+Delete deletes the open attachment.');
})();
