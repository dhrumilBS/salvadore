$(document).ready(function () {
    const escapeHtml = (value) => $('<div>').text(value ?? '').html();
    let rows = [];
    const categoryNames = { '%state-city%': 'HIMS', '%lab%': 'Lab', '%emr%': 'EMR', '%ehr%': 'EHR', '%pms%': 'PMS' };
    const childRows = () => rows.flatMap(item => item.textdata || []);
    const setResponse = (type, message) => $('#response').removeClass('alert-success alert-danger').addClass(`alert alert-${type}`).text(message);
    function renderRows() {
        const query = $('#searchInput').val().toLowerCase().trim();
        const status = $('#statusInput').val();
        const filtered = rows.filter(item => {
            const matchesText = `${item.post_title} ${item.post_name} ${(item.textdata || []).map(child => `${child.post_title} ${child.post_name}`).join(' ')}`.toLowerCase().includes(query);
            const matchesStatus = !status || item.post_status === status || (item.textdata || []).some(child => child.post_status === status);
            return matchesText && matchesStatus;
        });
        if (!filtered.length) { $('#date_add').html('<div class="empty-state"><div class="empty-icon mb-2">&#128269;</div><strong>No matching templates</strong><p class="mb-0 mt-1">Try a different search term.</p></div>'); return; }
        const tableRows = filtered.map((item, index) => {
            const parentRow = `<tr><td>${index + 1}</td><td>${escapeHtml(item.id)}</td><td class="fw-semibold">${escapeHtml(item.post_title)}</td><td><span class="status-badge">${escapeHtml(item.post_status)}</span></td><td class="text-secondary">${escapeHtml(item.post_name)}</td><td>${escapeHtml(item.menu_order)}</td></tr>`;
            const childRows = (item.textdata || []).map(child => `<tr><td></td><td>${escapeHtml(child.id)}</td><td class="ps-4 text-secondary">&rdca; ${escapeHtml(child.post_title)}</td><td><span class="status-badge">${escapeHtml(child.post_status)}</span></td><td class="text-secondary">${escapeHtml(child.post_name)}</td><td>${escapeHtml(child.menu_order)}</td></tr>`).join('');
            return parentRow + childRows;
        }).join('');
        const tableHTML = `<div class="table-wrap"><table class="table table-hover align-middle mb-0"><thead><tr><th scope="col">#</th><th scope="col">ID</th><th scope="col">Post title</th><th scope="col">Status</th><th scope="col">Slug</th><th scope="col">Order</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
        $('#date_add').html(tableHTML);
        $('#clearFilters').toggleClass('d-none', !query && !status);
    }
    function updateFilterOptions() {
        const statuses = [...new Set(rows.flatMap(item => [item.post_status, ...(item.textdata || []).map(child => child.post_status)]).filter(Boolean))].sort();
        $('#statusInput').find('option:not(:first)').remove();
        statuses.forEach(status => $('#statusInput').append($('<option>', { value: status, text: status })));
    }
    function flattenRows() { return rows.flatMap(item => [item, ...(item.textdata || []).map(child => ({ ...child, parent: item.post_title }))]); }
    function csvValue(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
    function exportCsv() {
        const csv = [['Type', 'Parent', 'ID', 'Post title', 'Status', 'Slug', 'Order'], ...flattenRows().map(item => [item.parent ? 'Child' : 'Parent', item.parent || '', item.id, item.post_title, item.post_status, item.post_name, item.menu_order])].map(row => row.map(csvValue).join(',')).join('\n');
        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); link.download = `${categoryNames[$('#category').val()].toLowerCase()}-templates.csv`; link.click(); URL.revokeObjectURL(link.href);
    }
    $('#searchInput, #statusInput').on('input change', renderRows);
    $('#clearFilters').on('click', function () { $('#searchInput').val(''); $('#statusInput').val(''); renderRows(); });
    $('#exportButton').on('click', exportCsv);
    $('#copyButton').on('click', function () { navigator.clipboard.writeText(JSON.stringify(rows, null, 2)).then(() => setResponse('success', 'Template JSON copied to clipboard.')); });
    $('#myForm').on('submit', function (event) {
        event.preventDefault();

        const formData = {
            category: $('#category').val()
        };

        rows = [];
        $('#parentCount, #childCount').text('0');
        $('#searchWrap, #statusWrap, #clearFilters').addClass('d-none');
        $('#exportButton, #copyButton').prop('disabled', true);
        $('#resultSummary').text(`Loading ${categoryNames[formData.category]} templates...`);
        $('#date_add').html('<div class="empty-state"><span class="loading-icon d-inline-block mb-3"></span><p class="mb-0">Loading templates...</p></div>');
        $('#response').removeClass('alert alert-success alert-danger').html('');
        $('#searchInput').val(''); $('#statusInput').val('');
        $('#submitButton').prop('disabled', true).text('Loading...');

        $.ajax({
            url: './submit.php',
            type: 'POST',
            data: formData,
            dataType: 'json', // expecting JSON response
            success: function (response) {
                rows = Object.values(response.data || {});
                $('#resultSummary').text(`${rows.length} template${rows.length === 1 ? '' : 's'} found`);
                $('#parentCount').text(rows.length); $('#childCount').text(childRows().length);
                $('#searchWrap, #statusWrap').toggleClass('d-none', rows.length === 0);
                $('#exportButton, #copyButton').prop('disabled', rows.length === 0);
                updateFilterOptions();
                setResponse('success', `Loaded ${rows.length} template${rows.length === 1 ? '' : 's'} for ${categoryNames[formData.category]}.`);
                renderRows();
            },
            error: function (xhr, status, error) {
                $('#resultSummary').text('Unable to load templates.');
                $('#date_add').html('<div class="empty-state"><div class="empty-icon mb-2">&#9888;</div><strong>Something went wrong</strong><p class="mb-0 mt-1">Please try again in a moment.</p></div>');
                $('#response').addClass('alert alert-danger').text(`Could not load templates: ${error}`);
            },
            complete: function () {
                $('#submitButton').prop('disabled', false).html('Load templates <span aria-hidden="true">&rarr;</span>');
            }
        });
    });
});