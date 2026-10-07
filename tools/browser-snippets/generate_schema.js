// Builds FAQPage JSON-LD from the page's Enfold toggles (.av_toggle_section)
// and copies the <script> tag to the clipboard, ready to paste.
(() => {
	const copy = t => navigator.clipboard?.writeText(t) ?? new Promise((ok, no) => { const a = Object.assign(document.createElement('textarea'), { value: t }); document.body.append(a); a.select(); const r = document.execCommand('copy'); a.remove(); r ? ok() : no(); }); // http pages have no Clipboard API
	const clean = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
	const faqs = [...document.querySelectorAll('.av_toggle_section')]
		.map(s => ({ q: clean(s.querySelector('.toggler')), a: clean(s.querySelector('.toggle_content')) }))
		.filter(f => f.q && f.a);
	if (!faqs.length) return console.warn('No FAQ toggles (.av_toggle_section) found on this page.');

	const schema = {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
	};
	const tag = `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`;
	console.log(schema);
	copy(tag).then(
		() => console.log(`%cFAQ schema with ${faqs.length} questions copied.`, 'color:#17a172;font-weight:bold'),
		() => console.log(tag)
	);
})();
