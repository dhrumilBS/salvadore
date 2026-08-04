let currentEntries = [];
let nextId = 1;
let editingId = null;
let deleteId = null;

function typeBadge(type) {
    const t = String(type ?? '');
    const cls = {
        "301": "badge-301",
        "410": "badge-410"
    }[t] || "badge-other";
    return `<span class="badge-type ${cls}">${t || "-"}</span>`;
}

// values: { "0": {origin, url, type, format}, "1": {...}, ... } — indexed, origin is a field on each item
function flattenRows(values) {
    return Object.entries(values ?? {}).map(([key, item]) => ({
        id: nextId++,
        origin: item?.origin ?? '',
        url: item?.url ?? '',
        type: item?.type
    }));
}

function getFilteredEntries() {
    const q = document.getElementById('q').value.toLowerCase().trim();
    const ft = document.getElementById('ft').value;
    return currentEntries.filter(e => {
        const mq = !q || (e.origin ?? "").toLowerCase().includes(q) || (e.url ?? "").toLowerCase().includes(q);
        const mt = !ft || String(e.type) === ft;
        return mq && mt;
    });
}

function updateStats(filtered) {
    document.getElementById('stTotal').textContent = currentEntries.length;
    let count301 = 0;
    let count410 = 0;
    currentEntries.forEach(e => {
        if (String(e.type) === "301") count301++;
        if (String(e.type) === "410") count410++;
    });
    document.getElementById('st301').textContent = count301;
    document.getElementById('st410').textContent = count410;
    document.getElementById('stShowing').textContent = filtered.length;
}

function render() {
    const tbody = document.querySelector("#dataTable tbody");
    const filtered = getFilteredEntries();
    updateStats(filtered);

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-msg">${currentEntries.length ? 'No entries match your search' : 'No entries found'}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((e, i) => `
                <tr class="row-click" onclick="openEdit(${e.id})">
                    <td>${i + 1}</td>
                    <td class="mono">${e.origin || '-'}</td>
                    <td class="mono">${e.url || '-'}</td>
                    <td>${typeBadge(e.type)}</td>
                    <td class="col-act"><div class="ra">
                        <button class="ib" onclick="event.stopPropagation(); openEdit(${e.id})" title="Edit">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="ib del" onclick="event.stopPropagation(); openConf(${e.id})" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                    </div></td>
                </tr>`).join('');
}

function renderRows(values) {
    currentEntries = flattenRows(values);
    document.getElementById('q').value = '';
    document.getElementById('ft').value = '';
    render();
}

function showTableState(msg, isError) {
    currentEntries = [];
    document.getElementById('stTotal').textContent = '0';
    document.getElementById('st301').textContent = '0';
    document.getElementById('st410').textContent = '0';
    document.getElementById('stShowing').textContent = '0';
    const tbody = document.querySelector("#dataTable tbody");
    tbody.innerHTML = `<tr><td colspan="5" class="state-msg${isError ? ' error' : ''}">${msg}</td></tr>`;
}

function fetchOptionData() {
    return fetch("./api.php", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
    }).then(async response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    });
}

function loadOptionData() {
    showTableState('<span class="spinner-border spinner-border-sm"></span> Loading…', false);
    fetchOptionData().then(result => {
        if (result.success && result.data && typeof result.data === 'object') {
            renderRows(result.data);
        } else {
            showTableState(result.msg || 'No data found', false);
        }
    }).catch(error => {
        console.error(error);
        showTableState('Failed to load option data', true);
    });
}

// ── add / edit / delete (in-memory only — nothing is saved here) ──────
function openAdd() {
    editingId = null;
    document.getElementById('editTitle').textContent = 'Add redirect';
    document.getElementById('eOrigin').value = '';
    document.getElementById('eUrl').value = '';
    document.getElementById('eType').value = '301';
    document.getElementById('editOv').classList.add('open');
}

function openEdit(id) {
    const e = currentEntries.find(x => x.id === id);
    if (!e) return;
    editingId = id;
    document.getElementById('editTitle').textContent = 'Edit redirect';
    document.getElementById('eOrigin').value = e.origin;
    document.getElementById('eUrl').value = e.url;
    document.getElementById('eType').value = String(e.type ?? '301');
    document.getElementById('editOv').classList.add('open');
}

function closeEdit() {
    document.getElementById('editOv').classList.remove('open');
    editingId = null;
}

function saveEntry() {
    const origin = document.getElementById('eOrigin').value.trim();
    const url = document.getElementById('eUrl').value.trim();
    const type = parseInt(document.getElementById('eType').value, 10);
    if (!origin) return;

    if (editingId === null) {
        currentEntries.push({ id: nextId++, origin, url, type });
    } else {
        const e = currentEntries.find(x => x.id === editingId);
        if (e) { e.origin = origin; e.url = url; e.type = type; }
    }

    closeEdit();
    render();
}

function openConf(id) {
    deleteId = id;
    const e = currentEntries.find(x => x.id === id);
    document.getElementById('confMsg').textContent = `Delete "${e ? e.origin : ''}"? This only removes it from this in-memory table, not the database.`;
    document.getElementById('confOv').classList.add('open');
}

function closeConf() {
    document.getElementById('confOv').classList.remove('open');
    deleteId = null;
}

function doDelete() {
    currentEntries = currentEntries.filter(e => e.id !== deleteId);
    closeConf();
    render();
}

// ── preview update (dry run — no DB write) ─────────────────────────────
function generatePreview() {
    const btn = document.getElementById('previewBtn');
    const out = document.getElementById('previewOut');
    btn.disabled = true;
    btn.textContent = 'Generating…';

    const entries = currentEntries.map(e => ({ origin: e.origin, url: e.url, type: e.type }));

    fetch('./api.php?action=preview_update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries })
    })
        .then(response => response.json())
        .then(result => {
            btn.disabled = false;
            btn.textContent = 'Generate preview';

            if (!result.success) {
                out.style.display = 'block';
                document.getElementById('baseOut').textContent = '';
                document.getElementById('plainOut').textContent = result.msg || 'Preview failed';
                return;
            }

            document.getElementById('baseLabel').textContent =
                `${result.base.option_name} (${result.base.count} entries)`;
            document.getElementById('plainLabel').textContent =
                `${result.plain.option_name} (${result.plain.count} entries)`;
            document.getElementById('baseOut').textContent = result.base.serialized;
            document.getElementById('plainOut').textContent = result.plain.serialized;
            out.style.display = 'block';
        })
        .catch(error => {
            console.error(error);
            btn.disabled = false;
            btn.textContent = 'Generate preview';
            out.style.display = 'block';
            document.getElementById('baseOut').textContent = '';
            document.getElementById('plainOut').textContent = 'Failed to generate preview';
        });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('iconMoon').style.display = theme === 'light' ? 'none' : 'block';
    document.getElementById('iconSun').style.display = theme === 'light' ? 'block' : 'none';
}

(function initTheme() {
    const stored = localStorage.getItem('theme');
    const preferred = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(preferred);
})();

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', next);
        applyTheme(next);
    });

    document.getElementById('editOv').addEventListener('click', e => {
        if (e.target === document.getElementById('editOv')) closeEdit();
    });
    document.getElementById('confOv').addEventListener('click', e => {
        if (e.target === document.getElementById('confOv')) closeConf();
    });

    loadOptionData();
});
