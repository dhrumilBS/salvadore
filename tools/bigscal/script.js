document.addEventListener('DOMContentLoaded', function () {

    const $ = (id) => document.getElementById(id);
    const previewEl = $('preview');
    const codeEl = $('htmlOutput');
    const emptyEl = $('emptyState');
    const copyBtn = $('copyBtn');
    const outMeta = $('outMeta');
    let lastHtml = '';          // raw generated HTML - what Copy puts on the clipboard
    let activeView = 'preview';


    /* ========================== Tool tabs ========================== */
    document.querySelectorAll('.tab').forEach((btn) => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === this));
            document.querySelectorAll('.form').forEach((f) => { f.hidden = f.id !== this.dataset.target; });
            // Box / CTA preview themselves live; Blog Post waits for Generate.
            if (this.dataset.target === 'boxForm') liveBox();
            else if (this.dataset.target === 'ctaForm') liveCta();
            else showOutput('');
        });
    });


    /* ========================== Output: preview / HTML view ========================== */
    document.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', function () {
            activeView = this.dataset.view;
            document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === this));
            renderView();
        });
    });

    function showOutput(html) {
        lastHtml = html || '';
        previewEl.innerHTML = forPreview(lastHtml);
        codeEl.innerHTML = highlight(lastHtml);
        copyBtn.disabled = !lastHtml;
        outMeta.textContent = lastHtml ? `${lastHtml.length.toLocaleString()} characters` : '';
        renderView();
    }

    // Preview only: render the Enfold FAQ shortcodes as an accordion, the way the
    // live site shows them. The copied HTML keeps the shortcodes untouched.
    function forPreview(html) {
        return html
            .replace(/\[\/?av_toggle_container[^\]]*\]/g, '')
            .replace(/\[av_toggle title='([^']*)'[^\]]*\]([\s\S]*?)\[\/av_toggle\]/g,
                '<details class="faq-item"><summary>$1</summary>$2</details>');
    }

    function renderView() {
        const has = !!lastHtml;
        emptyEl.hidden = has;
        previewEl.hidden = !has || activeView !== 'preview';
        codeEl.hidden = !has || activeView !== 'code';
    }

    // Lightweight HTML syntax colouring for the code view (display only -
    // Copy always uses the raw lastHtml string).
    function highlight(html) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return esc(html)
            .replace(/(\[\/?av_[a-z_]+[^\]]*\])/g, '<span class="sc">$1</span>')
            .replace(/(&lt;\/?)([a-zA-Z0-9-]+)([^&]*?)(\/?&gt;)/g, (m, open, tag, attrs, close) =>
                `<span class="t">${open}${tag}</span>` +
                attrs.replace(/([a-zA-Z-:]+)=("[^"]*"|'[^']*')/g, '<span class="a">$1</span>=<span class="s">$2</span>') +
                `<span class="t">${close}</span>`);
    }


    /* ========================== Feedback: toast + inline errors ========================== */
    const toastEl = $('toast');
    let toastTimer;
    function toast(msg, type = 'success') {
        toastEl.className = `toast show ${type}`;
        toastEl.querySelector('i').className = 'bi ' + (type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle-fill');
        toastEl.querySelector('span').textContent = msg;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
    }

    function setError(id, msg, field) {
        const el = $(id);
        el.textContent = msg || '';
        el.hidden = !msg;
        document.querySelectorAll('.invalid').forEach((f) => f.classList.remove('invalid'));
        if (msg && field) { field.classList.add('invalid'); field.focus(); }
    }
    document.querySelectorAll('.input, .paste-area').forEach((f) =>
        f.addEventListener('input', () => f.classList.remove('invalid')));


    /* ========================== Shared helpers ========================== */
    const BOX_ICONS = {
        "pro-tip": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"></path></svg>`,
        "learnMore": `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>`,
        "note": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-notebook-icon lucide-notebook"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/></svg>`
    };

    function defaultBoxTitle(type) {
        if (type === 'learnMore') return 'Learn More';
        if (type === 'note') return 'Note';
        return 'Pro Tip';
    }

    // Build a box in the exact WordPress paste format.
    function buildBox(type, title, content) {
        const icon = BOX_ICONS[type] || '';
        return `<div class="box ${type}">
<div class="box-header">
<div class="box-title"><i class="box-icon">${icon}</i> ${title}</div>
<div class="line"></div>
</div>
<div class="box-content">

${content}

</div>
</div>`;
    }

    /*
     * Convert rich (TinyMCE / pasted) HTML into the WordPress "Text" editor format:
     *  - paragraphs become raw text separated by blank lines (wpautop re-wraps them)
     *  - headings / images stay on their own line
     *  - lists are re-indented to match the WP output ( space + tab before <li> )
     */
    function htmlToWP(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = (html || '').trim();
        const pieces = [];

        tmp.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent.trim();
                if (t) pieces.push(t);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName.toLowerCase();
            if (tag === 'p' || tag === 'div') {
                const inner = node.innerHTML.trim();
                if (inner) pieces.push(inner);
            } else if (/^h[1-6]$/.test(tag)) {
                const inner = node.innerHTML.trim();
                if (inner) pieces.push(`<${tag}>${inner}</${tag}>`);
            } else if (tag === 'ul' || tag === 'ol') {
                pieces.push(formatList(node));
            } else if (tag === 'figure') {
                const img = node.querySelector('img');
                if (img) pieces.push(img.outerHTML);
            } else {
                pieces.push(node.outerHTML.trim());
            }
        });

        return pieces.join('\n\n');
    }

    function formatList(listEl) {
        const tag = listEl.tagName.toLowerCase();
        let out = `<${tag}>\n`;
        listEl.querySelectorAll(':scope > li').forEach((li) => {
            const nested = li.querySelector(':scope > ul, :scope > ol');
            if (nested) {
                const clone = li.cloneNode(true);
                clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => n.remove());
                const text = clone.innerHTML.trim();
                out += ` \t<li>${text}\n${formatList(nested)}\n \t</li>\n`;
            } else {
                out += ` \t<li>${li.innerHTML.trim()}</li>\n`;
            }
        });
        out += `</${tag}>`;
        return out;
    }


    /* ========================== Info Box ========================== */
    const boxForm = $('boxForm');
    const boxTitle = $('title');

    function readBox() {
        const type = document.querySelector('input[name="type"]:checked')?.value || 'pro-tip';
        const title = boxTitle.value.trim() || defaultBoxTitle(type);
        const content = $('editor').value.trim();
        return { type, title, content };
    }

    function liveBox() {
        const { type, title, content } = readBox();
        showOutput(content ? buildBox(type, title, content) : '');
    }

    boxForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const { type, title, content } = readBox();
        if (!content) { setError('boxError', 'Please write the box content.', $('editor')); return; }
        setError('boxError', '');
        showOutput(buildBox(type, title, content));
        toast('HTML generated');
    });
    boxForm.addEventListener('input', () => { $('boxError').hidden = true; liveBox(); });
    boxForm.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', () => {
        boxTitle.placeholder = defaultBoxTitle(r.value);
        liveBox();
    }));


    /* ========================== CTA ========================== */
    const ctaTemplate = $('blog-cta');
    const ctaForm = $('ctaForm');

    function buildCta() {
        const heading = $('heading').value.trim();
        const content = $('bullets').value.trim()
            .split('\n').filter((line) => line.trim() !== '');
        const btnText = $('btnText').value.trim();
        const btnLink = $('btnLink').value.trim() || '#a';

        const bulletHTML = content.map((item) => `\n<li>${item.trim()}</li>`).join('');

        // Function replacements avoid issues when content contains "$" sequences.
        return ctaTemplate.innerHTML
            .replace('${heading}', () => heading)
            .replace('${bulletHTML}', () => bulletHTML)
            .replace('${btnLink}', () => btnLink)
            .replace('${btnText}', () => btnText);
    }

    function liveCta() {
        const any = ['heading', 'bullets', 'btnText'].some((id) => $(id).value.trim());
        showOutput(any ? buildCta() : '');
    }

    ctaForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!$('heading').value.trim()) { setError('ctaError', 'Please add a heading.', $('heading')); return; }
        if (!$('btnText').value.trim()) { setError('ctaError', 'Please add the button text.', $('btnText')); return; }
        setError('ctaError', '');
        showOutput(buildCta());
        toast('HTML generated');
    });
    ctaForm.addEventListener('input', () => { $('ctaError').hidden = true; liveCta(); });


    /* ========================== Blog Post (single paste -> auto-convert) ========================== */
    const blogSectionForm = $('blogSectionForm');
    const pasteEl = $('blogPaste');

    function labelToType(label) {
        const l = label.toLowerCase().replace(/\s+/g, '');
        if (l === 'note') return 'note';
        if (l === 'learnmore') return 'learnMore';
        return 'pro-tip';
    }

    // Remove a leading label like "Quick Summary:" / "Pro Tip:" (even if wrapped in <strong>/<b>).
    function stripLabel(inner, labelGroup) {
        const re = new RegExp(
            '^\\s*(?:<(?:strong|b)>\\s*)?(?:' + labelGroup + ')\\s*:?\\s*(?:</(?:strong|b)>)?\\s*',
            'i'
        );
        return inner.replace(re, '').trim();
    }

    /*
     * Walk the pasted HTML once and assemble the expected blog output:
     *  - each <h2> starts a new <div class="blog-content">
     *  - "Quick Summary:" line  → top quickSummary box
     *  - "Pro Tip:/Note:/Learn More:" line → a box between sections
     *  - an <h2> titled "FAQ" → everything after becomes FAQ (q ends with "?", following text = answer)
     */
    // Strip clipboard junk Google Docs prepends: <meta>, <style>, comments, etc.
    function preClean(container) {
        container.querySelectorAll('meta, style, script, link, title').forEach((e) => e.remove());
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
        const comments = [];
        while (walker.nextNode()) comments.push(walker.currentNode);
        comments.forEach((c) => c.remove());
    }

    // Google Docs / contenteditable paste often wraps everything in a single
    // <b style="font-weight:normal"> or <div>. Drill into such wrappers so the
    // real headings/paragraphs become top-level nodes we can walk.
    function unwrap(container) {
        let changed = true;
        while (changed) {
            changed = false;
            const kids = Array.from(container.childNodes).filter(
                (n) => n.nodeType !== Node.TEXT_NODE || n.textContent.trim()
            );
            if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE &&
                ['b', 'span', 'div'].includes(kids[0].tagName.toLowerCase())) {
                container.innerHTML = kids[0].innerHTML;
                changed = true;
            }
        }
    }

    // Clean up the noise Google Docs adds on paste: redirect links, style/class
    // attributes, and styling-only <span> wrappers.
    function sanitize(container) {
        container.querySelectorAll('a[href]').forEach((a) => {
            const href = a.getAttribute('href');
            const m = href.match(/[?&]q=([^&]+)/);
            if (m && /google\.com\/url/i.test(href)) {
                try { a.setAttribute('href', decodeURIComponent(m[1])); } catch (e) { /* keep original */ }
            }
            if (/^https?:\/\//i.test(a.getAttribute('href'))) {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener');
            }
        });
        container.querySelectorAll('*').forEach((el) => {
            ['style', 'class', 'id', 'dir', 'role'].forEach((attr) => el.removeAttribute(attr));
        });
        container.querySelectorAll('span').forEach((span) => span.replaceWith(...span.childNodes));
    }

    function generateBlog(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = (html || '').trim();
        preClean(tmp);
        unwrap(tmp);
        sanitize(tmp);

        const out = [];        // top-level blocks: blog-content divs + boxes
        let buffer = [];       // pieces of the current blog-content section
        let quickSummary = null;
        const faqItems = [];
        let curFaq = null;
        let inFaq = false;

        const flush = () => {
            if (buffer.length) {
                out.push(`<div class="blog-content">\n${buffer.join('\n\n')}\n</div>`);
                buffer = [];
            }
        };

        Array.from(tmp.childNodes).forEach((rawNode) => {
            let node = rawNode;
            let tag, text, inner;

            if (node.nodeType === Node.TEXT_NODE) {
                text = node.textContent.trim();
                if (!text) return;
                tag = 'p'; inner = text;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                tag = node.tagName.toLowerCase();
                // unwrap figure → img
                if (tag === 'figure') {
                    const img = node.querySelector('img');
                    if (!img) return;
                    node = img; tag = 'img';
                }
                text = node.textContent.trim();
                inner = node.innerHTML.trim();
            } else {
                return;
            }

            // ----- FAQ mode: collect questions / answers -----
            if (inFaq) {
                const isQuestion = /^h[1-6]$/.test(tag) || /\?\s*$/.test(text);
                if (isQuestion && text) {
                    curFaq = { q: text.replace(/\s+/g, ' ').trim(), a: '' };
                    faqItems.push(curFaq);
                } else if (text) {
                    if (!curFaq) { curFaq = { q: text, a: '' }; faqItems.push(curFaq); }
                    else curFaq.a += (curFaq.a ? ' ' : '') + inner;
                }
                return;
            }

            // ----- FAQ section starts -----
            if (tag === 'h2' && /^(faqs?|frequently asked questions)$/i.test(text)) {
                flush();
                inFaq = true;
                return;
            }

            // skip empty (keep lists / images even if textContent is empty)
            if (!text && tag !== 'ul' && tag !== 'ol' && tag !== 'img') return;

            // ----- paragraph-level markers -----
            if (tag === 'p' || tag === 'div') {
                if (/^quick\s*summary\b/i.test(text)) {
                    quickSummary = stripLabel(inner, 'quick\\s*summary');
                    return;
                }
                const boxMatch = text.match(/^(pro\s*tip|note|learn\s*more)\b/i);
                if (boxMatch) {
                    const type = labelToType(boxMatch[1]);
                    const content = stripLabel(inner, 'pro\\s*tip|note|learn\\s*more');
                    flush();
                    out.push(buildBox(type, defaultBoxTitle(type), content));
                    return;
                }
                buffer.push(inner);
                return;
            }

            if (tag === 'h2') { flush(); buffer.push(`<h2>${inner}</h2>`); return; }
            if (/^h[3-6]$/.test(tag)) { buffer.push(`<${tag}>${inner}</${tag}>`); return; }
            if (tag === 'ul' || tag === 'ol') { buffer.push(formatList(node)); return; }
            if (tag === 'img') { buffer.push(node.outerHTML); return; }

            if (inner) buffer.push(node.outerHTML.trim());
        });
        flush();

        // assemble in expected order
        const parts = [];
        if (quickSummary) {
            parts.push(`<div class="quickSummary">\n\n<strong>Quick Summary:</strong> ${quickSummary}\n\n</div>`);
        }
        parts.push(...out);
        if (faqItems.length) parts.push(buildFaqSection(faqItems));

        let result = `<div class="blog-wrapper text-content">\n<div class="blog-content">\n${parts.join('\n')}\n</div>\n</div>`;
        const withSchema = document.getElementById('faqSchema').checked;
        if (faqItems.length && withSchema) result += '\n' + buildFaqSchema(faqItems);
        return result;
    }

    function runBlog(fromButton) {
        if (!pasteEl.textContent.trim()) {
            if (fromButton) setError('blogError', 'Paste your blog content (or load it from a Google Doc link) first.', pasteEl);
            return;
        }
        setError('blogError', '');
        showOutput(generateBlog(pasteEl.innerHTML));
        if (fromButton) toast('HTML generated');
    }

    blogSectionForm.addEventListener('submit', (e) => { e.preventDefault(); runBlog(true); });
    $('faqSchema').addEventListener('change', () => { if (lastHtml) runBlog(false); });

    // Summary of what was detected in the pasted content, so the user can check
    // the markers were picked up before copying.
    function updatePasteMeta() {
        const text = pasteEl.innerText || '';
        const words = (text.match(/\S+/g) || []).length;
        if (!words) { $('pasteMeta').textContent = ''; return; }
        const h2s = Array.from(pasteEl.querySelectorAll('h2'));
        const hasFaq = h2s.some((h) => /^(faqs?|frequently asked questions)$/i.test(h.textContent.trim()));
        const boxes = (text.match(/^\s*(pro\s*tip|note|learn\s*more)\b/gim) || []).length;
        const summary = /^\s*quick\s*summary\b/im.test(text);
        const parts = [`<b>${words.toLocaleString()}</b> words`, `<b>${h2s.length}</b> H2 sections`];
        if (boxes) parts.push(`<b>${boxes}</b> info box${boxes === 1 ? '' : 'es'}`);
        if (summary) parts.push('quick summary');
        if (hasFaq) parts.push('FAQ');
        $('pasteMeta').innerHTML = 'Detected: ' + parts.join(' &middot; ');
    }
    pasteEl.addEventListener('input', () => { $('blogError').hidden = true; updatePasteMeta(); });
    pasteEl.addEventListener('paste', () => setTimeout(() => { updatePasteMeta(); runBlog(false); }, 0));

    $('clearPaste').addEventListener('click', () => {
        pasteEl.innerHTML = '';
        updatePasteMeta();
        showOutput('');
        pasteEl.focus();
    });

    /* ---------- FAQ output (av_toggle shortcodes) ---------- */
    function buildFaqSection(items) {
        const cid = 'av-' + Math.random().toString(36).slice(2, 9);
        let toggles = '';
        items.forEach((it, i) => {
            const title = it.q.replace(/'/g, '’'); // protect the shortcode attribute
            toggles += `\n[av_toggle title='${title}' av_uid='av-${i + 1}']\n<p class="text-content">${it.a}</p>\n[/av_toggle]\n`;
        });
        return `<div class="blog-content">
<h2>FAQ</h2>
[av_toggle_container initial='0' mode='accordion' styling='av-elegant-toggle' colors='custom' background_color='#ffffff' border_color='#ffffff' toggle_icon_color='#6aca00' background_gradient_current_direction='vertical' background_gradient_current_color1='#000000' background_gradient_current_color2='#ffffff' custom_class='faq-content' av_uid='${cid}']
${toggles}
[/av_toggle_container]

</div>`;
    }

    /* ---------- FAQ JSON-LD schema ---------- */
    function buildFaqSchema(items) {
        const schema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": items.map((it) => ({
                "@type": "Question",
                "name": it.q,
                "acceptedAnswer": { "@type": "Answer", "text": it.a }
            }))
        };
        return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n<\/script>`;
    }


    /* ========================== Google Doc loader ========================== */
    // Reads a Google Doc link, asks the local backend (server.js) to convert it to
    // formatted HTML, then drops it into the paste box and generates straight away.
    const loadBtn = $('loadDocBtn');
    loadBtn.addEventListener('click', fetchDocument);
    $('docLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchDocument(); } });

    async function fetchDocument() {
        const linkInput = $('docLink');
        const link = linkInput.value.trim();
        if (!link) { setError('blogError', 'Paste a Google Doc link first.', linkInput); return; }

        // Accept full URLs (.../d/<id>/edit or ?id=<id>) or a bare document ID.
        const match = link.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || link.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
        const documentId = match ? match[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(link) ? link : '');
        if (!documentId) {
            setError('blogError', "That doesn't look like a Google Doc link.\nExpected: https://docs.google.com/document/d/DOC_ID/edit", linkInput);
            return;
        }

        setError('blogError', '');
        const oldHtml = loadBtn.innerHTML;
        loadBtn.disabled = true;
        loadBtn.classList.add('is-loading');
        loadBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Loading';

        try {
            const res = await fetch('http://localhost:3000/api/read-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Server responded with ${res.status}`);

            pasteEl.innerHTML = data.html || '';
            updatePasteMeta();
            runBlog(false);
            toast('Document loaded');
        } catch (err) {
            setError('blogError',
                'Could not load the document: ' + err.message +
                '\n- Is the doc server running? (node server.js)' +
                '\n- Is the doc shared with the service account or "Anyone with the link"?');
        } finally {
            loadBtn.disabled = false;
            loadBtn.classList.remove('is-loading');
            loadBtn.innerHTML = oldHtml;
        }
    }


    /* ========================== Copy ========================== */
    copyBtn.addEventListener('click', async function () {
        if (!lastHtml) return;
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(lastHtml); ok = true; }
        } catch (e) { ok = false; }
        if (!ok) ok = legacyCopy(lastHtml);
        if (!ok) { toast('Could not copy - open the HTML view and copy manually', 'error'); return; }

        toast('HTML copied - paste it into the WordPress Text editor');
        const label = copyBtn.querySelector('span');
        copyBtn.classList.add('copied');
        label.textContent = 'Copied!';
        setTimeout(() => { copyBtn.classList.remove('copied'); label.textContent = 'Copy HTML'; }, 1800);
    });

    // Works on plain-HTTP LAN addresses, where navigator.clipboard is unavailable.
    function legacyCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }


    /* ========================== Keyboard: Ctrl/Cmd + Enter generates ========================== */
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
        const form = document.querySelector('.form:not([hidden])');
        if (form) { e.preventDefault(); form.requestSubmit(); }
    });

    renderView();
});
