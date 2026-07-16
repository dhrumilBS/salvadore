/* ============================================================
   Keyword Duplicate Finder
   ============================================================ */

/* ---------- UTILS ---------- */
function escapeHtml(t) { return (t || "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escCSV(v) { if (v === null || v === undefined) return ""; v = String(v); return (v.includes(",") || v.includes('"') || v.includes("\n")) ? `"${v.replace(/"/g, '""')}"` : v; }
function downloadCSV(csv, fn) { const b = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = fn; a.click(); URL.revokeObjectURL(u); }
function fmtDate(v) { return v ? String(v).split(" ")[0] : ""; }
function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms"; }

function showLoading(msg = "Loading…") {
    document.getElementById("loadingText").textContent = msg;
    document.getElementById("loadingOverlay").classList.add("show");
}
function hideLoading() { document.getElementById("loadingOverlay").classList.remove("show"); }

function toast(msg, type = "info", duration = 3000) {
    const c = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-dot"></div><span>${msg}</span>`;
    c.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 300); }, duration);
}

function changeDb(db) {
    const url = new URL(window.location);
    url.searchParams.set('conn', db);
    window.location.href = url.toString();
}

/* ---------- FETCH PERFORMANCE METER ---------- */
function updatePerf(totalMs, serverMs, rowCount) {
    const meter = document.getElementById("perfMeter");
    document.getElementById("perfTotal").textContent = fmtMs(totalMs);
    const serverEl = document.getElementById("perfServer");
    serverEl.textContent = serverMs != null ? `server ${fmtMs(serverMs)}` : "";
    // colour-code: green < 500ms, amber < 1500ms, red otherwise
    meter.classList.remove("perf-good", "perf-warn", "perf-slow");
    meter.classList.add(totalMs < 500 ? "perf-good" : totalMs < 1500 ? "perf-warn" : "perf-slow");
    meter.title = `Fetched ${rowCount.toLocaleString()} rows · round-trip ${fmtMs(totalMs)}` +
        (serverMs != null ? ` · server query ${fmtMs(serverMs)}` : "");
}

/* ---------- EXPORT DROPDOWN ---------- */
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");
exportBtn.addEventListener("click", e => { e.stopPropagation(); exportMenu.classList.toggle("open"); });
document.addEventListener("click", () => exportMenu.classList.remove("open"));
exportMenu.addEventListener("click", e => e.stopPropagation());

/* ---------- TOGGLE PILL ---------- */
const dupToggle = document.getElementById("dupToggle");
const onlyDupCb = document.getElementById("onlyDup");
if (localStorage.getItem("onlyDup") === "1") { onlyDupCb.checked = true; dupToggle.classList.add("active"); }
onlyDupCb.addEventListener("change", () => {
    dupToggle.classList.toggle("active", onlyDupCb.checked);
    localStorage.setItem("onlyDup", onlyDupCb.checked ? "1" : "0");
    loadPosts();
});

/* ---------- KEYWORD FILTER CHIP ---------- */
const filterChip = document.getElementById("filterChip");
const filterChipValue = document.getElementById("filterChipValue");
let activeKeyword = "";

function applyKeywordFilter(kw = "") {
    activeKeyword = kw;
    if (filterChip && filterChipValue) {
        if (activeKeyword) {
            filterChipValue.textContent = activeKeyword;
            filterChip.style.display = "flex";
        } else {
            postcat.value = '';
            filterChipValue.textContent = '';
            filterChip.style.display = "none";
        }
    }

    if (dataTable) {
        dataTable.draw();
    }
}


document.getElementById("filterChipClear").addEventListener("click", () => applyKeywordFilter(""));

/* custom search: when a keyword is active, only show rows with that exact keyword */
$.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
    if (!activeKeyword) return true;
    const row = dataTable.row(dataIndex).data();
    return (row.categories || "").toLowerCase().trim() === activeKeyword.toLowerCase().trim();
});

/* ---------- LOAD POST TYPES ---------- */
function loadPostTypes() {
    const post_types = ['page', 'post'];
    const sel = document.getElementById("posttype");
    const cur = new URLSearchParams(window.location.search).get("post_type") || "post";
    sel.innerHTML = `<option value="">Select type</option>`;
    post_types.forEach(pt => {
        sel.innerHTML += `<option value="${pt}"${pt === cur ? " selected" : ""}>${pt}</option>`;
    });
}

/* ---------- DATATABLE ---------- */
let dataTable = null;
let allRows = [];

function updateStats(rows) {
    const total = rows.length;
    const withKw = rows.filter(r => r.focus_keyword).length;
    const dups = rows.filter(r => r.duplicate).length;
    const uniq = new Set(rows.filter(r => r.duplicate && r.focus_keyword).map(r => r.focus_keyword.toLowerCase().trim())).size;
    document.getElementById("statTotal").textContent = total.toLocaleString();
    document.getElementById("statWithKw").textContent = withKw.toLocaleString();
    document.getElementById("statDup").textContent = dups.toLocaleString();
    document.getElementById("statUniqKw").textContent = uniq.toLocaleString();
    document.getElementById("statNoKw").textContent = (total - withKw).toLocaleString();
}

function wpEditUrl(id) {
    // best-effort link to the WordPress editor for quick inspection
    return `https://botphonic.ai/wp-admin/post.php?post=${id}&action=edit`;
}

function loadPostCategories() {
    const params = new URLSearchParams(window.location.search);
    const currentDb = params.get('conn') || 'healthray';
    document.getElementById('db-select').value = currentDb;
    const fd = new FormData();
    fd.append("conn", currentDb);

    const sel = document.getElementById('postcat');

    fetch("./api/get-post-cat.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            sel.innerHTML = `<option value="">Select Category</option>`;
            json.categories.forEach(pc => {
                sel.innerHTML += `<option value="${pc.name}"${pc.name === activeKeyword ? " selected" : ""}>${pc.name} - ${pc.count}</option>`;
            });
        })
        .catch(err => { hideLoading(); toast("Failed to load posts", "error"); console.error(err); });
}

function loadPosts() {
    showLoading("Fetching posts…");
    const pt = document.getElementById("posttype").value || "post";
    const ps = document.getElementById("poststatus").value || "publish";
    const pc = document.getElementById("postcat").value;
    const onlyDup = onlyDupCb.checked ? 1 : 0;
    const params = new URLSearchParams(window.location.search);
    const currentDb = params.get('conn') || 'healthray';
    document.getElementById('db-select').value = currentDb;
    const fd = new FormData(); fd.append("post_type", pt); fd.append("post_status", ps); fd.append("only_duplicate", onlyDup); fd.append("conn", currentDb); fd.append("category", pc)

    if (dataTable) { dataTable.clear().destroy(); dataTable = null; }
    document.querySelector("#postTable tbody").innerHTML = "";
    applyKeywordFilter(""); // reset any active keyword filter on reload

    const t0 = performance.now();

    fetch("./api/get-posts.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            const totalMs = performance.now() - t0;
            hideLoading();

            if (json.status !== "success") {
                toast(json.error || "Server error", "error");
                return;
            }

            const rows = (json.data || []).map((r, i) => ({
                no: i + 1,
                id: r.ID,
                slug: r.post_name || "",
                title: r.post_title || "",
                guid: r.guid || "",
                post_date: r.post_date || "",
                post_status: r.post_status || "",
                post_modified: r.post_modified || "",
                categories: r.categories || "",
                focus_keyword: r.focus_keyword || "",
                duplicate: !!r.duplicate,
            }));

            allRows = rows;
            updateStats(rows);
            updatePerf(totalMs, json.server_time_ms, json.row_count ?? rows.length);

            /* colour map cycling 4 groups for duplicate keywords */
            const colorMap = {}; let ci = 1;
            rows.forEach(r => {
                if (r.duplicate && r.focus_keyword) {
                    const k = r.focus_keyword.toLowerCase().trim();
                    if (!colorMap[k]) { colorMap[k] = ci; ci = ci < 4 ? ci + 1 : 1; }
                }
            });

            dataTable = $("#postTable").DataTable({
                data: rows,
                lengthMenu: [[10, 25, 50, 100, 200, 300, 500], [10, 25, 50, 100, 200, 300, 500]],
                pageLength: 100,
                autoWidth: false,
                deferRender: true,
                dom: "<'dataTables_top'lf>rtip",
                language: {
                    search: "", searchPlaceholder: "Search title, slug, keyword…",
                    lengthMenu: "Show _MENU_ per page",
                    info: "_START_–_END_ of _TOTAL_ posts",
                    infoEmpty: "No posts found",
                    infoFiltered: "(filtered from _MAX_)",
                    zeroRecords: "No matching posts found",
                },
                order: [],
                columns: [
                    { data: "no", title: "#", orderable: false, render: data => `<span class="cell-no">${data}</span>` },
                    { data: "id", title: "ID", orderable: false, render: data => ` <a class="id-chip" href="${wpEditUrl(data)}" target="_blank" title="Open in WordPress editor"> ${data} </a>` },
                    {
                        data: "title", title: "Post Title", render: function (data, type, row) {
                            if (!data) { return `<span class="no-kw">—</span>`; }
                            return row.guid ? `<a class="post-link" href="${row.guid}" target="_blank">${escapeHtml(data)}</a>` : escapeHtml(data);
                        }
                    },
                    { data: "slug", title: "Slug", render: data => data ? `<span class="cell-slug">${escapeHtml(data)}</span>` : `<span class="no-kw">—</span>` },
                    { data: "categories", title: "Category", render: function (data) { return data ? `<button class="cat-chip" data-cat="${escapeHtml(data)}" title="Click to isolate this category">${escapeHtml(data)}</button>` : `<span class="no-kw">—</span>`; } },
                    { data: "post_status", title: "Status", render: data => data ? `<span class="cell-status">${escapeHtml(data)}</span>` : `<span class="cell-muted">—</span>` },
                    { data: "post_date", title: "Published", render: data => data ? `<span class="cell-date">${fmtDate(data)}</span>` : `<span class="cell-muted">—</span>` },
                    { data: "post_modified", title: "Last Modified", render: data => data ? `<span class="cell-date">${fmtDate(data)}</span>` : `<span class="cell-muted">—</span>` },
                    { data: "focus_keyword", title: "Focus Keyword", render: data => data ? `<span class="kw-badge">${escapeHtml(data)}</span>` : `<span class="no-kw">—</span>` }
                ],
                createdRow(row, rowData) {
                    if (rowData.duplicate && rowData.focus_keyword) {
                        const k = rowData.focus_keyword.toLowerCase().trim();
                        if (colorMap[k]) row.classList.add(`dup-group-${colorMap[k]}`);
                    }
                },
                scrollX: true,
                responsive: false,
            });

            /* click a focus keyword to isolate every post using it */
            $("#postTable tbody").on("click", ".cat-chip", function (e) {
                e.stopPropagation();
                filterCategory(this.dataset.cat);
            });
        })
        .catch(err => { hideLoading(); toast("Failed to load posts", "error"); console.error(err); });
}

function filterCategory(cat) {
    applyKeywordFilter(activeKeyword.toLowerCase() === cat.toLowerCase() ? "" : cat);
    document.getElementById("postcat").value = cat;
}

/* ---------- EXPORT ---------- */
function rowsToCSV(rows) {
    let csv = "No,ID,Title,Post Name,Category,Published,Last Modified,Focus Keyword,Duplicate\n";
    rows.forEach(r => {
        csv += [
            escCSV(r.no), escCSV(r.id), escCSV(r.title), escCSV(r.slug),
            escCSV(r.categories), escCSV(fmtDate(r.post_date)), escCSV(fmtDate(r.post_modified)),
            escCSV(r.focus_keyword), escCSV(r.duplicate ? "yes" : "no")
        ].join(",") + "\n";
    });
    return csv;
}

document.getElementById("exportCSV").addEventListener("click", () => {
    exportMenu.classList.remove("open");
    const rows = dataTable ? dataTable.rows({ search: "applied" }).data().toArray() : [];
    if (!rows.length) return toast("No rows to export", "info");
    downloadCSV(rowsToCSV(rows), "visible-rows.csv");
    toast(`Exported ${rows.length} rows`, "success");
});

document.getElementById("exportOnlyDup").addEventListener("click", () => {
    exportMenu.classList.remove("open");
    const rows = allRows.filter(d => d.duplicate);
    if (!rows.length) return toast("No duplicate rows found", "info");
    downloadCSV(rowsToCSV(rows), "duplicates-only.csv");
    toast(`Exported ${rows.length} duplicate rows`, "success");
});

document.getElementById("exportGrouped").addEventListener("click", () => {
    exportMenu.classList.remove("open");
    const dup = allRows.filter(d => d.duplicate && d.focus_keyword);
    if (!dup.length) return toast("No duplicate rows found", "info");
    // group by keyword so conflicting posts sit together
    dup.sort((a, b) => {
        const ka = a.focus_keyword.toLowerCase().trim(), kb = b.focus_keyword.toLowerCase().trim();
        return ka < kb ? -1 : ka > kb ? 1 : (a.id - b.id);
    });
    downloadCSV(rowsToCSV(dup), "grouped-duplicates.csv");
    toast(`Exported ${dup.length} grouped rows`, "success");
});

/* ---------- REFRESH / INIT ---------- */
refreshTable.onchange = loadPosts;
posttype.onchange = loadPosts;
poststatus.onchange = loadPosts;
document.getElementById("postcat").onchange = e => filterCategory(e.target.value);

/* ---------- SIDEBAR NAV ---------- */
document.getElementById("navRefresh")?.addEventListener("click", e => { e.preventDefault(); loadPosts(); });
document.getElementById("navExport")?.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); exportMenu.classList.toggle("open"); });
document.getElementById("navDuplicates")?.addEventListener("click", e => {
    e.preventDefault();
    onlyDupCb.checked = !onlyDupCb.checked;
    onlyDupCb.dispatchEvent(new Event("change"));
    document.getElementById("navDuplicates").classList.toggle("active", onlyDupCb.checked);
});

/* ============================================================
   POST ID LOOKUP  (load by IDs + bulk / single status update)
   ============================================================ */
const STATUS_KEY = "savedPostIds";
const idTableBody = () => document.querySelector("#idTable tbody");
let idRows = []; // currently displayed lookup rows

function currentConn() {
    const params = new URLSearchParams(window.location.search);
    return params.get("conn") || "healthray";
}

function parseIds(raw) {
    return [...new Set((raw || "").split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => n > 0))];
}

function statusBadge(s) {
    const known = ["publish", "draft", "trash", "pending", "private"];
    const cls = known.includes(s) ? `status-${s}` : "status-private";
    return `<span class="status-badge ${cls}">${escapeHtml(s || "—")}</span>`;
}

function statusOptions(selected) {
    const opts = [
        ["publish", "Publish"], ["draft", "Draft"], ["pending", "Pending"],
        ["private", "Private"], ["trash", "Trash"]
    ];
    return opts.map(([v, l]) => `<option value="${v}"${v === selected ? " selected" : ""}>${l}</option>`).join("");
}

function renderIdRows() {
    const tb = idTableBody();
    if (!idRows.length) {
        tb.innerHTML = `<tr class="idl-empty"><td colspan="8">No posts found for the given IDs.</td></tr>`;
        document.getElementById("bulkBar").hidden = true;
        return;
    }
    document.getElementById("bulkBar").hidden = false;
    tb.innerHTML = idRows.map(r => `
        <tr data-id="${r.ID}">
            <td><input type="checkbox" class="idl-check" value="${r.ID}"></td>
            <td><a class="id-chip" href="${wpEditUrl(r.ID)}" target="_blank" title="Open in WordPress editor">${r.ID}</a></td>
            <td>${r.guid ? `<a class="post-link" href="${r.guid}" target="_blank">${escapeHtml(r.post_title || "—")}</a>` : escapeHtml(r.post_title || "—")}</td>
            <td>${r.categories ? escapeHtml(r.categories) : `<span class="no-kw">—</span>`}</td>
            <td class="idl-status-cell">${statusBadge(r.post_status)}</td>
            <td><span class="cell-date">${fmtDate(r.post_modified)}</span></td>
            <td>${r.focus_keyword ? `<span class="kw-badge">${escapeHtml(r.focus_keyword)}</span>` : `<span class="no-kw">—</span>`}</td>
            <td>
                <div class="idl-row-actions">
                    <select class="styled idl-row-status">${statusOptions(r.post_status)}</select>
                    <button class="btn btn-primary idl-row-apply" data-id="${r.ID}">Update</button>
                </div>
            </td>
        </tr>`).join("");
    refreshBulkCount();
}

function refreshBulkCount() {
    const checks = [...document.querySelectorAll(".idl-check")];
    const n = checks.filter(c => c.checked).length;
    document.getElementById("bulkCount").textContent = `${n} selected`;
    const all = checks.length > 0 && n === checks.length;
    document.getElementById("idSelectAll").checked = all;
    document.getElementById("idSelectAllHead").checked = all;
}

function loadByIds() {
    const raw = document.getElementById("postIdsInput").value;
    const ids = parseIds(raw);
    localStorage.setItem(STATUS_KEY, raw.trim()); // remember for next time

    if (!ids.length) { toast("Enter at least one valid post ID", "info"); return; }

    showLoading("Fetching posts by ID…");
    const fd = new FormData();
    fd.append("ids", ids.join(","));
    fd.append("conn", currentConn());

    fetch("./api/get-posts-by-ids.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            hideLoading();
            if (json.status !== "success") { toast(json.error || "Server error", "error"); return; }
            idRows = json.data || [];
            renderIdRows();
            const meta = document.getElementById("idlMeta");
            let html = `Found <b>${json.row_count}</b> of <b>${ids.length}</b> requested.`;
            if (json.missing && json.missing.length) {
                html += ` <span class="idl-missing">Not found: ${json.missing.join(", ")}</span>`;
            }
            meta.innerHTML = html;
            toast(`Loaded ${json.row_count} post(s)`, "success");
        })
        .catch(err => { hideLoading(); toast("Failed to load posts", "error"); console.error(err); });
}

function updateStatus(ids, status, onDone) {
    if (!ids.length) { toast("Nothing selected", "info"); return; }
    showLoading("Updating status…");
    const fd = new FormData();
    fd.append("ids", ids.join(","));
    fd.append("status", status);
    fd.append("conn", currentConn());

    fetch("./api/update-post-status.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            hideLoading();
            if (json.status !== "success") { toast(json.error || "Update failed", "error"); return; }
            // reflect new status in local data + UI
            ids.forEach(id => {
                const row = idRows.find(r => String(r.ID) === String(id));
                if (row) row.post_status = status;
                const tr = document.querySelector(`#idTable tbody tr[data-id="${id}"]`);
                if (tr) {
                    tr.querySelector(".idl-status-cell").innerHTML = statusBadge(status);
                    tr.querySelector(".idl-row-status").value = status;
                }
            });
            toast(`Updated ${json.affected_rows} post(s) → ${status}`, "success");
            if (onDone) onDone();
        })
        .catch(err => { hideLoading(); toast("Update failed", "error"); console.error(err); });
}

/* ---- ID LOOKUP EVENT WIRING ---- */
document.getElementById("loadByIds").addEventListener("click", loadByIds);
document.getElementById("clearIds").addEventListener("click", () => {
    document.getElementById("postIdsInput").value = "";
    localStorage.removeItem(STATUS_KEY);
    idRows = [];
    renderIdRows();
    document.getElementById("idlMeta").innerHTML = "";
    idTableBody().innerHTML = `<tr class="idl-empty"><td colspan="8">Enter post IDs above and click <b>Load Posts</b>.</td></tr>`;
});

// single-row update
idTableBody().addEventListener("click", e => {
    const btn = e.target.closest(".idl-row-apply");
    if (!btn) return;
    const id = btn.dataset.id;
    const status = btn.closest("tr").querySelector(".idl-row-status").value;
    updateStatus([id], status);
});

// row checkbox change
idTableBody().addEventListener("change", e => {
    if (e.target.classList.contains("idl-check")) refreshBulkCount();
});

// select-all (both checkboxes)
function toggleAll(checked) {
    document.querySelectorAll(".idl-check").forEach(c => c.checked = checked);
    refreshBulkCount();
}
document.getElementById("idSelectAll").addEventListener("change", e => toggleAll(e.target.checked));
document.getElementById("idSelectAllHead").addEventListener("change", e => toggleAll(e.target.checked));

// bulk apply
document.getElementById("bulkApply").addEventListener("click", () => {
    const ids = [...document.querySelectorAll(".idl-check:checked")].map(c => c.value);
    if (!ids.length) { toast("Select at least one post", "info"); return; }
    const status = document.getElementById("bulkStatus").value;
    updateStatus(ids, status, refreshBulkCount);
});

document.addEventListener("DOMContentLoaded", () => {
    loadPostCategories()
    loadPostTypes();
    loadPosts();
    // restore previously entered IDs
    const saved = localStorage.getItem(STATUS_KEY);
    if (saved) document.getElementById("postIdsInput").value = saved;
});
