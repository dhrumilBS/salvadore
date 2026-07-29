const STATUSES = ["publish", "draft", "pending", "private", "future", "trash"];
let POSTS = [];               // cached list from the server
const dirty = new Set();      // ids the user edited but hasn't saved
let currentPostType = "page";
let currentStatus = "all";

// Escape a value so it is safe inside an HTML attribute.
const esc = v => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const statusOptions = current => STATUSES
    .map(s => `<option value="${s}" ${s === current ? "selected" : ""}>${s}</option>`)
    .join("");

const exportUrl = () =>
    `api/export_link.php?post_type=${encodeURIComponent(currentPostType)}&status=${encodeURIComponent(currentStatus)}`;

const updateExportBtn = () => $("#exportBtn").attr("href", exportUrl());

function showToast(message, success = true) {
    const toastEl = document.getElementById("toastMsg");
    document.getElementById("toastText").textContent = message;
    toastEl.classList.remove("bg-success", "bg-danger");
    toastEl.classList.add(success ? "bg-success" : "bg-danger");
    new bootstrap.Toast(toastEl).show();
}

// ---- render ------------------------------------------------------
function renderRows(list) {
    const rows = list.map((post, i) => `
        <tr id="row-${post.id}" data-id="${post.id}">
            <td class="col-check"><input type="checkbox" class="form-check-input row-check" value="${post.id}"></td>
            <td class="col-no text-muted">${i + 1}</td>
            <td class="col-id"><a class="id-badge" href="${esc(post.guid)}" target="_blank" rel="noopener">#${post.id}</a></td>
            <td><input class="form-control field" data-f="post_title" id="title-${post.id}" value="${esc(post.post_title)}"></td>
            <td><span class="slug-text">${esc(post.post_name)}</span></td>
            <td class="col-meta text-truncate" title="${esc(post.meta_title)}">${esc(post.meta_title)}</td>
            <td class="col-meta text-truncate" title="${esc(post.meta_description)}">${esc(post.meta_description)}</td>
            <td class="col-status">
                <select class="form-select field status-select status--${esc(post.post_status)}" data-f="post_status" id="status-${post.id}">
                    ${statusOptions(post.post_status)}
                </select>
            </td>
            <td class="col-date"><input class="form-control field" data-f="post_date" id="date-${post.id}" value="${esc(post.post_date)}"></td>
            <td class="col-order"><input class="form-control field text-center" type="number" data-f="menu_order" id="order-${post.id}" value="${esc(post.menu_order)}"></td>
            <td class="col-save"><button class="btn btn-primary btn-sm save-btn" onclick="updatePost(${post.id})">Save</button></td>
        </tr>
    `).join("");

    $("#postRows").html(rows);
    $("#loadingState").addClass("d-none");
    $("#emptyState").toggleClass("d-none", list.length > 0);
    updateSelectionUI();
}

function applyFilter() {
    const q = $("#searchInput").val().trim().toLowerCase();
    if (!q) return renderRows(POSTS);
    renderRows(POSTS.filter(p =>
        [p.post_title, p.post_name, p.post_status, p.meta_title, p.meta_description, p.id]
            .some(v => String(v ?? "").toLowerCase().includes(q))
    ));
}

// ---- load --------------------------------------------------------
function loadPosts() {
    $("#loadingState").removeClass("d-none");
    $("#emptyState").addClass("d-none");
    updateExportBtn();


    $.post("./api/get_post.php", { post_type: currentPostType, status: currentStatus }, res => {
        if (!res.success) {
            POSTS = [];
            renderRows([]);
            $("#emptyState").text(res.msg || "No data found");
            return;
        }
        POSTS = res.data;
        dirty.clear();
        $("#searchInput").val("");
        renderRows(POSTS);
    }).fail(() => { showToast("Failed to load posts", false); $("#loadingState").addClass("d-none"); });
}

// ---- read a row's current values from the inputs -----------------
function readRow(id) {
    const cached = POSTS.find(p => String(p.id) === String(id)) || {};
    return {
        id,
        post_title: $("#title-" + id).val(),
        post_name: cached.post_name ?? "",
        post_status: $("#status-" + id).val(),
        menu_order: $("#order-" + id).val(),
        post_date: $("#date-" + id).val(),
    };
}

// ---- single update ----------------------------------------------
function updatePost(id) {
    const data = readRow(id);
    const btn = $(`#row-${id} .save-btn`);
    btn.text("Saving…").prop("disabled", true);

    $.post("./api/update_post.php", data, res => {
        if (res.success) {
            showToast(res.msg, true);
            syncCache(data);
            dirty.delete(String(id));
            $(`#row-${id}`).removeClass("row--dirty");
            btn.removeClass("btn-warning").addClass("btn-primary").text("Save");
        } else {
            showToast(res.msg, false);
            btn.text("Save");
        }
        btn.prop("disabled", false);
    }).fail(() => { showToast("Request failed", false); btn.text("Save").prop("disabled", false); });
}

// ---- bulk update -------------------------------------------------
function bulkSave() {
    const ids = $(".row-check:checked").map((_, el) => el.value).get();
    if (!ids.length) { showToast("Select at least one row", false); return; }

    const overrideStatus = $("#bulkStatus").val();
    const payload = ids.map(id => {
        const row = readRow(id);
        if (overrideStatus) row.post_status = overrideStatus;
        return row;
    });

    const btn = $("#bulkSaveBtn");
    btn.text("Saving…").prop("disabled", true);

    $.post("./api/bulk_update_post.php", { posts: JSON.stringify(payload) }, res => {
        showToast(res.msg, res.success);
        if (res.success) {
            payload.forEach(syncCache);
            payload.forEach(p => dirty.delete(String(p.id)));
            $("#bulkStatus").val("");
            applyFilter(); // refresh display while preserving search & order
            $("#selectAll").prop("checked", false);
        }
        btn.prop("disabled", false).text("💾 Save selected");
    }).fail(() => { showToast("Request failed", false); btn.prop("disabled", false).text("💾 Save selected"); });
}

// keep the in-memory cache in sync after a successful save
function syncCache(data) {
    const p = POSTS.find(x => String(x.id) === String(data.id));
    if (p) Object.assign(p, data);
}

// ---- selection UI ------------------------------------------------
function updateSelectionUI() {
    const checks = $(".row-check");
    const checked = $(".row-check:checked");
    $("#selCount").text(checked.length);
    $("#bulkBar").toggleClass("bulk-bar--active", checked.length > 0);
    $("#selectAll").prop("checked", checks.length > 0 && checked.length === checks.length);
}

// ---- events ------------------------------------------------------
$(document).on("change", "#selectAll", function () {
    $(".row-check").prop("checked", this.checked);
    updateSelectionUI();
});

$(document).on("change", ".row-check", updateSelectionUI);

$("#clearSelBtn").on("click", () => {
    $(".row-check, #selectAll").prop("checked", false);
    updateSelectionUI();
});

$("#bulkSaveBtn").on("click", bulkSave);
$("#reloadBtn").on("click", loadPosts);

$(document).on("click", "#typeTabs a", function (e) {
    e.preventDefault();
    $("#typeTabs a").removeClass("active");
    $(this).addClass("active");
    currentPostType = $(this).data("type");
    loadPosts();
});

$("#statusFilter").on("change", function () {
    currentStatus = $(this).val();
    loadPosts();
});

// mark a row dirty when any field changes
$(document).on("input change", ".field", function () {
    const id = $(this).closest("tr").data("id");
    dirty.add(String(id));
    $(`#row-${id}`).addClass("row--dirty");
    $(`#row-${id} .save-btn`).removeClass("btn-primary").addClass("btn-warning");
    if ($(this).hasClass("status-select")) {
        this.className = this.className.replace(/status--\S+/g, "") + " status--" + this.value;
    }
});

$("#searchInput").on("input", applyFilter);

// Enter = save row, Esc = blur
$(document).on("keydown", ".field", function (e) {
    const id = $(this).closest("tr").data("id");
    if (e.key === "Enter") { e.preventDefault(); updatePost(id); }
    if (e.key === "Escape") { e.target.blur(); }
});

// warn before leaving with unsaved edits
window.addEventListener("beforeunload", e => {
    if (dirty.size > 0) { e.preventDefault(); e.returnValue = ""; }
});

// ---- init --------------------------------------------------------
$("#statusFilter").val(currentStatus);
loadPosts();
