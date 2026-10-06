const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(cors()); // Allows your frontend to talk to this backend
app.use(express.json());

// NOTE: The Google Docs API does NOT support API keys — it requires an
// authenticated principal. We use a Service Account:
//   1. Google Cloud Console → enable "Google Docs API".
//   2. Create a Service Account → create a JSON key → save it next to this
//      file as "service-account.json".
//   3. Either share the doc with the service account's email
//      (…@….iam.gserviceaccount.com), OR set the doc to
//      "Anyone with the link can view".
const auth = new google.auth.GoogleAuth({
  keyFile: './service-account.json',
  scopes: ['https://www.googleapis.com/auth/documents.readonly'],
});

const docs = google.docs({ version: 'v1', auth });

// Helper function to turn Google Doc styles into HTML tags
function convertElementToHtml(element) {
  if (!element.textRun) return '';

  let text = element.textRun.content;
  const style = element.textRun.textStyle || {};

  // Escape basic HTML tags in original text to prevent layout breaking
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Preserve the trailing newline handling: strip the newline Docs appends to
  // each run so it doesn't leak into the middle of inline formatting.
  text = text.replace(/\n$/, '');
  if (!text) return '';

  // Apply styling tags based on Google Doc metadata properties
  if (style.bold) text = `<strong>${text}</strong>`;
  if (style.italic) text = `<em>${text}</em>`;
  if (style.underline) text = `<u>${text}</u>`;
  if (style.strikethrough) text = `<del>${text}</del>`;
  if (style.foregroundColor && style.foregroundColor.color && style.foregroundColor.color.rgbColor) {
    const rgb = style.foregroundColor.color.rgbColor;
    const r = Math.round((rgb.red || 0) * 255);
    const g = Math.round((rgb.green || 0) * 255);
    const b = Math.round((rgb.blue || 0) * 255);
    text = `<span style="color: rgb(${r},${g},${b});">${text}</span>`;
  }

  // Hyperlinks — wrap the (already styled) text in an anchor.
  if (style.link && style.link.url) {
    text = `<a href="${style.link.url}" target="_blank" rel="noopener">${text}</a>`;
  }

  return text;
}

// Turn all the text runs of a paragraph into a single inline HTML string.
function paragraphToInlineHtml(paragraph) {
  let html = '';
  (paragraph.elements || []).forEach((el) => { html += convertElementToHtml(el); });
  return html;
}

// Decide whether a bulleted paragraph belongs to an ordered or unordered list
// by inspecting the document's list definitions.
function isOrderedList(doc, listId, nestingLevel) {
  const list = doc.lists && doc.lists[listId];
  const level = list && list.listProperties &&
    list.listProperties.nestingLevels &&
    list.listProperties.nestingLevels[nestingLevel || 0];
  const glyph = level && level.glyphType;
  // Ordered glyphs are things like DECIMAL / ALPHA / ROMAN; bullets have none.
  return !!glyph && glyph !== 'GLYPH_TYPE_UNSPECIFIED';
}

app.post('/api/read-doc', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // Fetch document structure from Google API
    const response = await docs.documents.get({ documentId });
    const doc = response.data;
    const bodyContent = doc.body.content;
    let htmlOutput = '';

    let openList = null; // { tag: 'ul' | 'ol', listId }

    const closeList = () => {
      if (openList) { htmlOutput += `</${openList.tag}>`; openList = null; }
    };

    // Loop through structural elements (paragraphs, tables, lists)
    bodyContent.forEach(element => {
      if (!element.paragraph) { closeList(); return; }

      const paragraph = element.paragraph;
      const paragraphHtml = paragraphToInlineHtml(paragraph);

      // ----- List items (paragraphs that carry a bullet) -----
      if (paragraph.bullet) {
        const listId = paragraph.bullet.listId;
        const tag = isOrderedList(doc, listId, paragraph.bullet.nestingLevel) ? 'ol' : 'ul';

        // Start a fresh list when none is open or the list changes.
        if (!openList || openList.listId !== listId || openList.tag !== tag) {
          closeList();
          htmlOutput += `<${tag}>`;
          openList = { tag, listId };
        }
        htmlOutput += `<li>${paragraphHtml}</li>`;
        return;
      }

      // Any non-bullet paragraph ends the current list.
      closeList();

      // Skip genuinely empty paragraphs so we don't emit stray <p></p>.
      if (!paragraphHtml.trim()) return;

      // Map Google Docs headings to HTML tags
      const type = paragraph.paragraphStyle?.namedStyleType;
      if (type === 'HEADING_1') htmlOutput += `<h1>${paragraphHtml}</h1>`;
      else if (type === 'HEADING_2') htmlOutput += `<h2>${paragraphHtml}</h2>`;
      else if (type === 'HEADING_3') htmlOutput += `<h3>${paragraphHtml}</h3>`;
      else if (type === 'HEADING_4') htmlOutput += `<h4>${paragraphHtml}</h4>`;
      else htmlOutput += `<p>${paragraphHtml}</p>`;
    });

    closeList();

    res.json({ html: htmlOutput });
  } catch (error) {
    // Surface the real Google API reason (invalid key, API not enabled,
    // doc not shared, etc.) so the frontend can show something actionable.
    const apiError = error?.response?.data?.error;
    const detail = apiError?.message || error?.message || 'Unknown error';
    console.error('read-doc failed:', detail);
    res.status(error?.response?.status || 500).json({
      error: `Failed to read Google Document: ${detail}`
    });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
