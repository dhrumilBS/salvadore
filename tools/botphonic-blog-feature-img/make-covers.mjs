#!/usr/bin/env node
// Make Botphonic blog covers from the command line, with the same renderer as the Cover Studio page (index.html + script.js).
// Usage:   node make-covers.mjs covers.txt [output-folder]
// Needs:   Node 22 or newer, Chrome or Edge installed, and internet (the two cover fonts load from Google Fonts).
// covers.txt: one post per line   URL | Cover title | Second line | Style   (see PROMPT-for-ChatGPT.md)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, 'index.html');
const input = process.argv[2];
const outDir = path.resolve(process.argv[3] || 'covers');
const LIMIT = 90000;

function fail(msg) { console.error('\nStopped: ' + msg); process.exit(1); }
if (!input) fail('give the list file, for example:  node make-covers.mjs covers.txt');
if (!fs.existsSync(input)) fail('cannot find ' + input);
if (!fs.existsSync(studio)) fail('index.html (the Cover Studio page) must sit next to make-covers.mjs');
if (!fs.existsSync(path.join(here, 'script.js'))) fail('script.js (the cover renderer) must sit next to make-covers.mjs');
if (typeof WebSocket === 'undefined') fail('this needs Node 22 or newer (node --version shows ' + process.version + ')');

function findBrowser() {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const list = {
    win32: [pf + '\\Google\\Chrome\\Application\\chrome.exe', pf86 + '\\Google\\Chrome\\Application\\chrome.exe', local + '\\Google\\Chrome\\Application\\chrome.exe', pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe', pf + '\\Microsoft\\Edge\\Application\\msedge.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] || [];
  return list.find(p => p && fs.existsSync(p));
}
const browserPath = findBrowser();
if (!browserPath) fail('no Chrome or Edge found. Install Chrome, or set CHROME_PATH to the browser program.');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'botphonic-covers-'));
// Chrome's launcher can hand off to a background process and exit at once, so find the browser through
// the DevToolsActivePort file it writes into its profile, not through the launcher process.
spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', pathToFileURL(studio).href], { stdio: 'ignore' }).on('error', e => fail('could not start the browser: ' + e.message));
let port, browserWsPath;
for (let i = 0; i < 100 && !port; i++) {
  try { [port, browserWsPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch {}
  if (!port) await new Promise(r => setTimeout(r, 200));
}
if (!port) fail('the browser did not start. Set CHROME_PATH to Chrome or Edge and try again.');
async function closeBrowser() {
  await new Promise(res => { try { const b = new WebSocket('ws://127.0.0.1:' + port + browserWsPath); b.onopen = () => { b.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(res, 800); }; b.onerror = () => res(); } catch { res(); } });
  for (let i = 0; i < 10; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise(r => setTimeout(r, 300)); } }
}
async function stop(msg) { console.error('\nStopped: ' + msg); await closeBrowser(); process.exit(1); }

let page;
for (let i = 0; i < 50 && !page; i++) {
  const list = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
  page = list.find(t => t.type === 'page' && t.url.startsWith('file:'));
  if (!page) await new Promise(r => setTimeout(r, 200));
}
if (!page) await stop('could not open the studio page in the browser');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to the browser')); }).catch(e => stop(e.message));
let nextId = 1; const waiting = new Map();
ws.onmessage = ev => { const msg = JSON.parse(ev.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
async function run(expression) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const msg = await new Promise(r => waiting.set(id, r));
  if (msg.error) throw new Error(msg.error.message);
  if (msg.result.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text);
  return msg.result.result.value;
}

// wait for the page script, then for the exact cover fonts
for (let i = 0; i < 100; i++) { if (await run('!!(window.CoverStudio && window.CoverStudio.exportCover)').catch(() => false)) break; await new Promise(r => setTimeout(r, 200)); }
const fontsOk = await run(`(async()=>{ await Promise.race([Promise.all([document.fonts.load('700 40px Manrope'),document.fonts.load('italic 400 40px Newsreader')]),new Promise(r=>setTimeout(r,15000))]); return document.fonts.check('700 40px Manrope')&&document.fonts.check('italic 400 40px Newsreader'); })()`);
if (!fontsOk) await stop('the cover fonts did not load. Check the internet connection and try again.');

const text = fs.readFileSync(input, 'utf8');
const { rows, errors } = await run('CoverStudio.parseRows(' + JSON.stringify(text) + ')');
if (errors.length) await stop('fix these lines in ' + input + ':\n  ' + errors.join('\n  '));
if (!rows.length) await stop('no covers found in ' + input);

fs.mkdirSync(outDir, { recursive: true });
const index = [['image_file', 'blog_post_url', 'cover_title', 'cover_line', 'style', 'suggested_alt_text', 'size_kb']];
const cell = s => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
console.log('Making ' + rows.length + ' cover' + (rows.length === 1 ? '' : 's') + ' into ' + outDir);
for (const row of rows) {
  const r = await run(`CoverStudio.exportCover(${JSON.stringify(row)}).then(r=>new Promise(res=>{ const f=new FileReader(); f.onload=()=>res({b64:String(f.result).split(',')[1],type:r.blob.type,size:r.blob.size}); f.readAsDataURL(r.blob); }))`);
  if (r.type !== 'image/webp' || r.size >= LIMIT) await stop(row.slug + ' came out as ' + r.type + ', ' + r.size + ' bytes');
  const file = row.slug + '.webp';
  fs.writeFileSync(path.join(outDir, file), Buffer.from(r.b64, 'base64'));
  index.push([file, 'https://botphonic.ai/blog/' + row.slug + '/', row.title, row.sub, row.v, row.title + ': ' + row.sub, (r.size / 1000).toFixed(1)]);
  console.log('  ' + file.padEnd(60) + (r.size / 1000).toFixed(1).padStart(6) + ' KB   ' + row.v);
}
fs.writeFileSync(path.join(outDir, '_image-index.csv'), '\ufeff' + index.map(r => r.map(cell).join(',')).join('\n'));
console.log('Done. ' + rows.length + ' WebP files (1600 x 900, under 90 KB) and _image-index.csv');
ws.close();
await closeBrowser();
process.exit(0);
