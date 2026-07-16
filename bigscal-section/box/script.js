document.addEventListener('DOMContentLoaded', function () {

    /* ========================== Tab switching ========================== */
    document.querySelectorAll(".option-btn").forEach((btn) => {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
            this.classList.add("active");

            document.querySelectorAll(".form").forEach((form) => form.classList.add("d-none"));
            const target = this.getAttribute("data-target");
            document.getElementById(target).classList.remove("d-none");
        });
    });


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


    /* ========================== Dynamic Box Generator (standalone) ========================== */
    const boxForm = document.getElementById('boxForm');
    if (boxForm) {
        boxForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const type = document.querySelector('input[name="type"]:checked')?.value;
            let title = document.getElementById('title').value.trim();
            if (!title) title = defaultBoxTitle(type);

            const content = document.getElementById('editor').value.trim();

            if (!type || !content) {
                alert("Please select a type and enter content.");
                return;
            }

            const html = buildBox(type, title, content);
            document.getElementById('preview').innerHTML = html;
            document.getElementById('htmlOutput').textContent = html;
        });
    }


    /* ========================== Blog CTA Generator ========================== */
    const ctaTemplate = document.getElementById('blog-cta');
    const ctaForm = document.getElementById('ctaForm');
    if (ctaForm && ctaTemplate) {
        ctaForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const heading = document.getElementById('heading').value.trim();
            const content = document.getElementById('bullets').value.trim()
                .split('\n').filter((line) => line.trim() !== '');
            const btnText = document.getElementById('btnText').value.trim();
            const btnLink = document.getElementById('btnLink').value.trim() || '#a';

            const bulletHTML = content.map((item) => `\n<li>${item.trim()}</li>`).join('');

            // Function replacements avoid issues when content contains "$" sequences.
            const html = ctaTemplate.innerHTML
                .replace('${heading}', () => heading)
                .replace('${bulletHTML}', () => bulletHTML)
                .replace('${btnLink}', () => btnLink)
                .replace('${btnText}', () => btnText);

            document.getElementById('preview').innerHTML = html;
            document.getElementById('htmlOutput').textContent = html;
        });
    }


    /* ========================== Blog Content Builder (single paste → auto-convert) ========================== */
    const blogSectionForm = document.getElementById('blogSectionForm');

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

    blogSectionForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pasteEl = document.getElementById('blogPaste');
        if (!pasteEl.textContent.trim()) {
            alert('Please paste your blog content first.');
            return;
        }
        const html = generateBlog(pasteEl.innerHTML);
        document.getElementById('preview').innerHTML = html;
        document.getElementById('htmlOutput').textContent = html;
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


    /* ========================== Copy button ========================== */
    const copyBtn = document.getElementById('copyBtn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', function () {
        const text = document.getElementById('htmlOutput').innerText;
        fallbackCopy(text);
        showPopover(copyBtn, 'copied!');
    });
});

function fallbackCopy(text) {
    const tempInput = document.createElement('textarea');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
}

/* ========================== Google Doc loader ========================== */
// Called from the "Load Content" button in the Blog Content tab.
// Reads a Google Doc link, asks the backend to convert it to formatted HTML,
// then drops that HTML straight into the rich paste box (#blogPaste) so the
// existing "Generate HTML" pipeline can turn it into WordPress markup.
async function fetchDocument() {
    const linkInput = document.getElementById('docLink');
    const target = document.getElementById('blogPaste');
    const btn = document.querySelector('#blogSectionForm button[onclick="fetchDocument()"]');

    const link = (linkInput?.value || '').trim();
    if (!link) {
        alert('Please paste a Google Doc link first.');
        return;
    }

    // Accept full URLs (…/d/<id>/edit or ?id=<id>) or a bare document ID.
    const match = link.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || link.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    const documentId = match ? match[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(link) ? link : '');
    if (!documentId) {
        alert('That doesn\'t look like a Google Doc link. Expected something like:\nhttps://docs.google.com/document/d/DOC_ID/edit');
        return;
    }

    const oldLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
        const res = await fetch('http://localhost:3000/api/read-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Server responded with ${res.status}`);

        target.innerHTML = data.html || '';
        target.focus();
    } catch (err) {
        alert(
            'Could not load the document.\n\n' + err.message +
            '\n\nChecklist:\n' +
            '• Is the backend running?  →  node server.js\n' +
            '• Is the doc shared as "Anyone with the link"?\n' +
            '• Is a valid Google API key set in server.js?'
        );
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
    }
}

function showPopover(element, message) {
    const popover = bootstrap.Popover.getInstance(element)
        || new bootstrap.Popover(element, {
            content: message,
            placement: 'top',
            trigger: 'manual',
            customClass: 'copy-popover'
        });

    popover.setContent({ '.popover-body': message });
    popover.show();
    setTimeout(() => popover.hide(), 2000);
}
