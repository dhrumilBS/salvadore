// On a live WordPress page: shows an "Edit" button (Elementor editor for
// Elementor pages, the normal editor otherwise) and copies the post ID.
(() => {
	const copy = t => navigator.clipboard?.writeText(t) ?? new Promise((ok, no) => { const a = Object.assign(document.createElement('textarea'), { value: t }); document.body.append(a); a.select(); const r = document.execCommand('copy'); a.remove(); r ? ok() : no(); }); // http pages have no Clipboard API
	const cls = [...document.body.classList];
	const id = (cls.find(c => /^(page-id|postid)-\d+$/.test(c)) || '').replace(/\D+/g, '');
	if (!id) return console.warn('No page-id-/postid- class on <body> - not a single post or page.');

	const elementor = cls.includes('elementor-page');
	document.getElementById('wp-edit-snippet-btn')?.remove();
	const a = document.createElement('a');
	a.id = 'wp-edit-snippet-btn';
	a.href = `/wp-admin/post.php?post=${id}&action=${elementor ? 'elementor' : 'edit'}`;
	a.target = '_blank';
	a.textContent = `Edit #${id}${elementor ? ' (Elementor)' : ''}`;
	a.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;border-radius:999px;background:#6552f6;color:#fff;font:600 14px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.25)';
	document.body.appendChild(a);

	copy(id).then(
		() => console.log(`Post ID ${id} copied.`),
		() => console.log(`Post ID: ${id} (clipboard blocked - click the page first)`)
	);
})();
