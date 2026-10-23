# Botphonic cover kit: instructions for AI coding agents

These instructions are for Kiro, Cursor, Codex, Windsurf, Claude Code or any assistant that can read files and run commands in this folder.
In Kiro, copy this file to `.kiro/steering/botphonic-covers.md` so it is always applied.

## Goal
Make blog feature images for botphonic.ai that match the existing set of covers exactly.

## Never
- Never edit the Cover Studio page (`index.html` and `script.js`). The cover design (colours, fonts, grain, layout, sizes) is locked inside the renderer in `script.js` and the font link in `index.html`.
- Never draw, generate, resize or re-compress images yourself, and never use an image-generation model.
- Never rename the output files.

## Steps
1. For each article, add one line to `covers.txt` (create it if missing):
   `URL | Cover title | Second line | Style`
   Write the text by following every rule in `PROMPT-for-ChatGPT.md` (title 3 to 7 words and at most 44 characters, second line at most 45 characters, no year, style is one of: Versus, Bands, Review, Corners, Dusk, Door, Crowd, Rise, Gap, Silk). `covers-example.txt` shows the format.
2. Run:
   `node make-covers.mjs covers.txt`
   It needs Node 22 or newer, Chrome or Edge installed, and internet access (the two cover fonts load from Google Fonts). If no browser is found, set the `CHROME_PATH` environment variable to the Chrome or Edge program and run again.
3. The script writes `covers/<post-slug>.webp` (1600 x 900 WebP, under 90 KB) and `covers/_image-index.csv`. It stops with a clear message if a line is wrong or a file would break the rules. Fix the line it names and run again.
4. Report back to the user: each file name, its size, and its style.

## Checks before you finish
- One `.webp` per line in `covers.txt`, named exactly after the post's URL slug.
- Every file is under 90 KB (the script enforces this).
- No year and no full stop in titles or second lines.
