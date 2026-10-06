const API = './api/list_files.php';

let current = '.';
let items = [];
let currentSite = 'healthray';
let urlBase = '.';

const list = document.getElementById('list');
const search = document.getElementById('search');
const reload = document.getElementById('reload');
const count = document.getElementById('count');
const folderLabel = document.getElementById('folderLabel');
const breadcrumbs = document.getElementById('breadcrumbs');
const siteSelect = document.getElementById('siteSelect');

/* ── Site switcher ─────────────────────────────────────────────
 * Lets this one browser list either this folder's own PHP/HTML files or a
 * sibling site's (see api/list_files.php's $SITES) - persisted in its own
 * "fb_site" cookie, scoped to this folder. */
async function loadSites() {
    const res = await fetch(API + '?action=sites');
    const data = await res.json();
    siteSelect.innerHTML = data.sites.map(s =>
        `<option value="${s.key}" data-url="${s.url}"${s.key === data.current ? ' selected' : ''}>${s.label}</option>`
    ).join('');
    currentSite = data.current;
    urlBase = siteSelect.selectedOptions[0]?.dataset.url || '.';
}

siteSelect.addEventListener('change', () => {
    currentSite = siteSelect.value;
    urlBase = siteSelect.selectedOptions[0]?.dataset.url || '.';
    document.cookie = `fb_site=${encodeURIComponent(currentSite)}; path=${location.pathname.replace(/[^/]*$/, '')}; max-age=${60 * 60 * 24 * 365}`;
    load('.');
});

async function load(folder = '.') {

    list.innerHTML = '<div class="message">Loading...</div>';

    const res = await fetch(API + '?site=' + encodeURIComponent(currentSite) + '&folder=' + encodeURIComponent(folder));
    const data = await res.json();
    if (data.error) {
        list.innerHTML = '<div class="message">' + data.error + '</div>';
        return;
    }
    current = data.folder;
    items = data.items;
    urlBase = data.url_base || urlBase;
    render();
    renderBreadcrumbs();
}

function render() {

    let q = search.value.toLowerCase();
    let filtered = items.filter(i =>
        i.name.toLowerCase().includes(q)
    );

    count.innerText = filtered.length + ' items';
    folderLabel.innerText = 'Folder: ' + current;

    if (!filtered.length) {
        list.innerHTML = '<div class="message">No files found</div>';
        return;
    }

    list.innerHTML = '';

    filtered.forEach(item => {
        // A folder with its own index.html/index.php is a dashboard - open it
        // directly instead of drilling into its file list first.
        const opensDirectly = item.isDir && item.hasIndex;
        const link = item.isDir
            ? (opensDirectly
                ? `<a class="action item" target="_blank" href="${urlBase}/${item.path}/">`
                : `<a href="#" class="action item" onclick="load('${item.path}')"> `)
            : `<a class="action item" target="_blank" href="${urlBase}/${item.path}">`;
        let html = `
                ${link}
                    <div class="icon"> ${item.isDir ? (opensDirectly ? '🧰' : '📁') : '📄'} </div>
                    <div class="name"> ${item.name} </div>
                  </a> `;
        list.innerHTML += html;
    });
}

function renderBreadcrumbs() {
    breadcrumbs.innerHTML = '';
    let root = document.createElement('button');
    root.innerText = 'Root';
    root.onclick = () => load('.');
    breadcrumbs.appendChild(root);
    if (current == '.') return;
    let parts = current.split('/');
    let path = '';

    parts.forEach((p, i) => {
        path += (i ? '/' : '') + p;
        let btn = document.createElement('button');
        btn.innerText = p;
        btn.onclick = () => load(path);
        breadcrumbs.appendChild(btn);
    });
}
search.addEventListener('input', render);
reload.onclick = () => load(current);
loadSites().then(() => load());