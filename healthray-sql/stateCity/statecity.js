const API_URL = './api/list_templates.php';
const pageTitle = document.getElementById('pageTitle');
const statusBox = document.getElementById('statusBox');
const tableBody = document.getElementById('tableBody');
const templateSelect = document.getElementById('templateSelect');
const bestInput = document.getElementById('bestInput');
const loadButton = document.getElementById('loadButton');
const metaRow = document.getElementById('metaRow');

const defaultTemplate = document.body.dataset.defaultTemplate || 'All';
const defaultBest = document.body.dataset.defaultBest || '';

function getActiveTemplate() {
    return templateSelect ? templateSelect.value : defaultTemplate;
}

function getActiveBest() {
    return bestInput ? bestInput.value.trim() : defaultBest;
}
console.log(pageTitle);

async function loadTemplateData(template = defaultTemplate, best = defaultBest) {
    const searchParams = new URLSearchParams();
    searchParams.set('template', template);
    if (best) searchParams.set('best', best);
    const url = `${API_URL}?${searchParams.toString()}`;

    statusBox.textContent = 'Loading records…';
    tableBody.innerHTML = '<tr><td colspan="11" class="text-center py-5 text-muted">Loading data…</td></tr>';

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || result.msg || 'Unknown API error');
        }

        if (pageTitle) {
            pageTitle.textContent = result.headerText || 'StateCity records';
        }
        renderTable(result.data);
        statusBox.textContent = `${result.data.length} top-level records loaded for ${result.template === 'ALL' ? 'All templates' : result.template}.`;
    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center py-5 text-danger">Unable to load data.</td></tr>';
        statusBox.textContent = err.message;
    }
}

function renderTable(rows) {
    if (!rows || !rows.length) {
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center py-5 text-muted">No records found.</td></tr>';
        return;
    }

    let html = '';
    let rowIndex = 0;
    let menuOrder = 1;

    rows.forEach((row, mainIndex) => {
        rowIndex++;
        html += `<tr>` +
            `<td>${rowIndex}</td>` +
            `<td>${mainIndex + 1}</td>` +
            `<td>${escapeHtml(row.template || '')}</td>` +
            `<td>${escapeHtml(row.id)}</td>` +
            `<td>${escapeHtml(row.post_title)}</td>` +
            `<td>${escapeHtml(row.post_name)}</td>` +
            `<td>${escapeHtml(row.post_status)}</td>` +
            `<td>${escapeHtml(row.meta_key || '')}</td>` +
            `<td>${escapeHtml(row.meta_value || '')}</td>` +
            `<td>${escapeHtml(row.menu_order)}</td>` +
            `<td><code>UPDATE wp_posts SET menu_order='${menuOrder}' WHERE id=${escapeHtml(row.id)};</code></td>` +
            `</tr>`;
        menuOrder++;

        if (Array.isArray(row.cityData)) {
            row.cityData.forEach((child, childIndex) => {
                rowIndex++;
                html += `<tr class="child-row">` +
                    `<td>${rowIndex}</td>` +
                    `<td>${mainIndex + 1}.${childIndex + 1}</td>` +
                    `<td>${escapeHtml(row.template || '')}</td>` +
                    `<td>${escapeHtml(child.id)}</td>` +
                    `<td>${escapeHtml(child.post_title)}</td>` +
                    `<td>${escapeHtml(child.post_name)}</td>` +
                    `<td>${escapeHtml(child.post_status)}</td>` +
                    `<td>${escapeHtml(child.meta_key || '')}</td>` +
                    `<td>${escapeHtml(child.meta_value || '')}</td>` +
                    `<td>${escapeHtml(child.menu_order)}</td>` +
                    `<td><code>UPDATE wp_posts SET menu_order='${menuOrder}' WHERE id=${escapeHtml(child.id)};</code></td>` +
                    `</tr>`;
                menuOrder++;
            });
        }
    });

    tableBody.innerHTML = html;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updateMetaRowVisibility() {
    if (!metaRow) return;
    if (templateSelect && templateSelect.value === 'META') {
        metaRow.style.display = 'block';
    } else {
        metaRow.style.display = 'none';
    }
}

if (templateSelect) {
    templateSelect.addEventListener('change', updateMetaRowVisibility);
}

if (loadButton) {
    loadButton.addEventListener('click', () => {
        loadTemplateData(getActiveTemplate(), getActiveBest());
    });
}

window.addEventListener('load', () => {
    updateMetaRowVisibility();
    loadTemplateData(defaultTemplate, defaultBest);
});
