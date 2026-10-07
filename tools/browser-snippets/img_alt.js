// Lists every image without alt text, outlines it in red on the page, and
// scrolls to the first one.
(() => {
	const missing = [...document.images].filter(img => !img.getAttribute('alt')?.trim());
	missing.forEach(img => { img.style.outline = '4px solid #ff3b5c'; img.style.outlineOffset = '-4px'; });
	if (!missing.length) return console.log('%cAll images have alt text ✓', 'color:#17a172;font-weight:bold');
	console.log(`%c${missing.length} of ${document.images.length} images have no alt text`, 'color:#d63649;font-weight:bold');
	console.table(missing.map(img => ({ src: img.currentSrc || img.src, size: `${img.naturalWidth}×${img.naturalHeight}`, visible: img.offsetParent !== null })));
	missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
})();
