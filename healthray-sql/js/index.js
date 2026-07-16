const API = './api/list_files.php';

let current = '.';
let items = [];

const list = document.getElementById('list');
const search = document.getElementById('search');
const reload = document.getElementById('reload');
const count = document.getElementById('count');
const folderLabel = document.getElementById('folderLabel');
const breadcrumbs = document.getElementById('breadcrumbs');

async function load(folder = '.') {

    list.innerHTML = '<div class="message">Loading...</div>';

    const res = await fetch(API + '?folder=' + encodeURIComponent(folder));
    const data = await res.json();
    if (data.error) {
        list.innerHTML = '<div class="message">' + data.error + '</div>';
        return;
    }
    current = data.folder;
    items = data.items;
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
        let html = `
                ${item.isDir ? `<a href="#" class="action item" onclick="load('${item.path}')"> ` : `<a class="action item" target="_blank" href="./${item.path}">`} 
                    <div class="icon"> ${item.isDir ? '📁' : '📄'} </div>
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
load();