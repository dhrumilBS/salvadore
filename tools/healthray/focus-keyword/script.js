/* ============================================================
   Keyword Duplicate Finder
   ============================================================ */

/* ---------- UTILS ---------- */
function escapeHtml(t) { return (t === null || t === undefined ? "" : String(t)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escCSV(v) { if (v === null || v === undefined) return ""; v = String(v); return (v.includes(",") || v.includes('"') || v.includes("\n")) ? `"${v.replace(/"/g, '""')}"` : v; }
function downloadCSV(csv, fn) { const b = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = fn; a.click(); URL.revokeObjectURL(u); }
function fmtDate(v) { return v ? String(v).split(" ")[0] : ""; }
function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms"; }

/* Legacy copy path — works on plain http (LAN access) and when the async
   Clipboard API refuses because the document is not focused. */
function copyTextLegacy(text) {
    return new Promise((resolve, reject) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
    });
}

function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(() => copyTextLegacy(text));
    }
    return copyTextLegacy(text);
}

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

function currentConn() {
    const params = new URLSearchParams(window.location.search);
    return params.get("conn") || "healthray";
}

/* Per-database preference keys so switching sites keeps its own state. */
function prefKey(name) { return `fk:${currentConn()}:${name}`; }

/* ---------- THEME ---------- */
const themeToggle = document.getElementById("themeToggle");
function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("fk-theme", t);
    if (themeToggle) themeToggle.querySelector(".tt-label").textContent = t === "dark" ? "Dark" : "Light";
}
applyTheme(localStorage.getItem("fk-theme") || document.documentElement.getAttribute("data-theme") || "light");
themeToggle?.addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

/* ---------- SITE CONTEXT (used for URLs + wp-admin links) ---------- */
let siteHome = localStorage.getItem(prefKey("home")) || "";
function setSiteHome(home) {
    if (!home) return;
    siteHome = home.replace(/\/+$/, "");
    localStorage.setItem(prefKey("home"), siteHome);
    const host = document.getElementById("siteHost");
    if (host) {
        try { host.textContent = new URL(siteHome).host; }
        catch (e) { host.textContent = siteHome; }
        host.title = siteHome;
    }
}
setSiteHome(siteHome);

function wpEditUrl(id) {
    return siteHome ? `${siteHome}/wp-admin/post.php?post=${id}&action=edit` : "";
}

/* ---------- URL CELL ---------- */
const APPROX_SOURCES = ["plain", "no-slug", "cpt-unknown", "none"];

function urlCell(row) {
    const url = row.url || "";
    if (!url) return `<span class="no-kw">—</span>`;

    const m = url.match(/^(https?:\/\/[^/]+)(.*)$/i);
    const origin = m ? m[1] : "";
    const path = m ? (m[2] || "/") : url;
    const approx = APPROX_SOURCES.includes(row.url_source) || row.url_pretty === false;

    const tipParts = [];
    if (row.title) tipParts.push(row.title);
    tipParts.push(url);
    if (approx) tipParts.push("Approximate: this post has no pretty permalink yet.");
    else if (row.url_source === "built" && row.post_status && row.post_status !== "publish") {
        tipParts.push("Rebuilt from the permalink structure (post is not published).");
    }

    return `<div class="url-cell">
        <a class="url-link${approx ? " url-approx" : ""}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tipParts.join("\n"))}"><span class="url-origin">${escapeHtml(origin)}</span><span class="url-path">${escapeHtml(path)}</span></a>
        ${approx ? `<span class="url-flag" title="No pretty permalink yet — this is the best-effort URL">approx</span>` : ""}
        <button type="button" class="url-copy" data-url="${escapeHtml(url)}" title="Copy URL" aria-label="Copy URL">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
        </button>
    </div>`;
}

/* one delegated handler covers both tables */
document.addEventListener("click", e => {
    const btn = e.target.closest(".url-copy");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    copyText(btn.dataset.url)
        .then(() => {
            btn.classList.add("copied");
            setTimeout(() => btn.classList.remove("copied"), 900);
            toast("URL copied", "success", 1600);
        })
        .catch(() => toast("Could not copy URL", "error"));
});

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

/* ---------- DROPDOWN MENUS ---------- */
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");
const colsBtn = document.getElementById("colsBtn");
const colsMenu = document.getElementById("colsMenu");

function closeMenus(except) {
    [exportMenu, colsMenu].forEach(m => { if (m && m !== except) m.classList.remove("open"); });
}
exportBtn.addEventListener("click", e => { e.stopPropagation(); closeMenus(exportMenu); exportMenu.classList.toggle("open"); });
colsBtn.addEventListener("click", e => { e.stopPropagation(); closeMenus(colsMenu); colsMenu.classList.toggle("open"); });
document.addEventListener("click", () => closeMenus());
exportMenu.addEventListener("click", e => e.stopPropagation());
colsMenu.addEventListener("click", e => e.stopPropagation());

/* ---------- TOGGLE PILL ---------- */
const dupToggle = document.getElementById("dupToggle");
const onlyDupCb = document.getElementById("onlyDup");
if (localStorage.getItem("onlyDup") === "1") { onlyDupCb.checked = true; dupToggle.classList.add("active"); }
onlyDupCb.addEventListener("change", () => {
    dupToggle.classList.toggle("active", onlyDupCb.checked);
    localStorage.setItem("onlyDup", onlyDupCb.checked ? "1" : "0");
    document.getElementById("navDuplicates")?.classList.toggle("active", onlyDupCb.checked);
    loadPosts();
});
document.getElementById("navDuplicates")?.classList.toggle("active", onlyDupCb.checked);

/* ============================================================
   CLIENT-SIDE FILTERS  (category · keyword · keyword presence)
   ============================================================ */
const filterChip = document.getElementById("filterChip");
const filterChipValue = document.getElementById("filterChipValue");
const kwChip = document.getElementById("kwChip");
const kwChipValue = document.getElementById("kwChipValue");
const presenceChip = document.getElementById("presenceChip");
const presenceChipValue = document.getElementById("presenceChipValue");

let activeKeyword = "";   // category name (kept as-is for backwards compatibility)
let activeFocusKw = "";   // exact focus keyword
let kwPresence = "";      // "" | "with" | "without"

function renderChips() {
    if (activeKeyword) { filterChipValue.textContent = activeKeyword; filterChip.hidden = false; filterChip.style.display = "inline-flex"; }
    else { filterChipValue.textContent = ""; filterChip.hidden = true; filterChip.style.display = "none"; }

    if (activeFocusKw) { kwChipValue.textContent = activeFocusKw; kwChip.hidden = false; kwChip.style.display = "inline-flex"; }
    else { kwChipValue.textContent = ""; kwChip.hidden = true; kwChip.style.display = "none"; }

    if (kwPresence) { presenceChipValue.textContent = kwPresence === "with" ? "is set" : "is missing"; presenceChip.hidden = false; presenceChip.style.display = "inline-flex"; }
    else { presenceChipValue.textContent = ""; presenceChip.hidden = true; presenceChip.style.display = "none"; }

    document.querySelectorAll(".stat-card").forEach(c => {
        const s = c.dataset.stat;
        const on = (s === "with" && kwPresence === "with") || (s === "without" && kwPresence === "without") ||
            (s === "dup" && onlyDupCb.checked) ||
            (s === "all" && !kwPresence && !activeKeyword && !activeFocusKw && !onlyDupCb.checked);
        c.classList.toggle("active", !!on);
    });
}

/* keeps the original name/behaviour: filters the table by category */
function applyKeywordFilter(kw = "") {
    activeKeyword = kw || "";
    if (!activeKeyword) {
        const pc = document.getElementById("postcat");
        if (pc) pc.value = "";
    }
    renderChips();
    if (dataTable) dataTable.draw();
}

function applyFocusKeywordFilter(kw = "") {
    activeFocusKw = kw || "";
    renderChips();
    if (dataTable) dataTable.draw();
}

function applyPresenceFilter(mode = "") {
    kwPresence = mode || "";
    renderChips();
    if (dataTable) dataTable.draw();
}

function clearAllFilters() {
    activeKeyword = "";
    activeFocusKw = "";
    kwPresence = "";
    const pc = document.getElementById("postcat");
    if (pc) pc.value = "";
    if (dataTable) dataTable.search("").draw();
    renderChips();
}

document.getElementById("filterChipClear").addEventListener("click", () => applyKeywordFilter(""));
document.getElementById("kwChipClear").addEventListener("click", () => applyFocusKeywordFilter(""));
document.getElementById("presenceChipClear").addEventListener("click", () => applyPresenceFilter(""));

/* custom search — only ever applied to #postTable */
$.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
    if (settings.nTable.id !== "postTable" || !dataTable) return true;
    const row = dataTable.row(dataIndex).data();
    if (!row) return true;

    if (activeKeyword && (row.categories || "").toLowerCase().trim() !== activeKeyword.toLowerCase().trim()) return false;
    if (activeFocusKw && (row.focus_keyword || "").toLowerCase().trim() !== activeFocusKw.toLowerCase().trim()) return false;
    if (kwPresence === "with" && !row.focus_keyword) return false;
    if (kwPresence === "without" && row.focus_keyword) return false;
    return true;
});

/* ---------- STAT CARD SHORTCUTS ---------- */
document.getElementById("statsRow").addEventListener("click", e => {
    const card = e.target.closest(".stat-card");
    if (!card) return;
    switch (card.dataset.stat) {
        case "all":
            if (onlyDupCb.checked) { onlyDupCb.checked = false; onlyDupCb.dispatchEvent(new Event("change")); }
            clearAllFilters();
            toast("Filters cleared", "info", 1600);
            break;
        case "with":
            applyPresenceFilter(kwPresence === "with" ? "" : "with");
            break;
        case "without":
            applyPresenceFilter(kwPresence === "without" ? "" : "without");
            break;
        case "dup":
            onlyDupCb.checked = !onlyDupCb.checked;
            onlyDupCb.dispatchEvent(new Event("change"));
            break;
        case "uniq":
            toggleKwPanel();
            break;
    }
});

/* ---------- CONFLICTING KEYWORD PANEL ---------- */
const kwPanel = document.getElementById("kwPanel");
document.getElementById("kwPanelClose").addEventListener("click", () => { kwPanel.hidden = true; });

function buildKwPanel() {
    const groups = new Map();
    allRows.forEach(r => {
        if (!r.duplicate || !r.focus_keyword) return;
        const k = r.focus_keyword.trim();
        const key = k.toLowerCase();
        if (!groups.has(key)) groups.set(key, { label: k, rows: [] });
        groups.get(key).rows.push(r);
    });

    const list = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
    const body = document.getElementById("kwPanelBody");
    document.getElementById("kwPanelHint").textContent = list.length
        ? `${list.length} keyword${list.length === 1 ? "" : "s"} used more than once — click one to isolate it`
        : "No duplicate keywords in the current result set";

    body.innerHTML = list.length
        ? list.map(g => `<button type="button" class="kw-group" data-kw="${escapeHtml(g.label)}" title="Show the ${g.rows.length} posts using this keyword">
                <span class="kg-label">${escapeHtml(g.label)}</span>
                <span class="kg-count">${g.rows.length}</span>
            </button>`).join("")
        : `<div class="kw-empty">Nothing to resolve here.</div>`;
    return list.length;
}

function toggleKwPanel() {
    if (!kwPanel.hidden) { kwPanel.hidden = true; return; }
    buildKwPanel();
    kwPanel.hidden = false;
    kwPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.getElementById("kwPanelBody").addEventListener("click", e => {
    const b = e.target.closest(".kw-group");
    if (!b) return;
    const kw = b.dataset.kw;
    const same = activeFocusKw.toLowerCase() === kw.toLowerCase();
    applyFocusKeywordFilter(same ? "" : kw);
    document.querySelectorAll(".kw-group").forEach(x => x.classList.toggle("active", !same && x === b));
    if (!same) document.getElementById("postsCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- POST TYPES ---------- */
function loadPostTypes() {
    const sel = document.getElementById("posttype");
    const urlType = new URLSearchParams(window.location.search).get("post_type");
    const wanted = urlType || localStorage.getItem(prefKey("post_type")) || "post";

    const fd = new FormData();
    fd.append("conn", currentConn());

    const fallback = () => {
        sel.innerHTML = ["post", "page"]
            .map(pt => `<option value="${pt}"${pt === wanted ? " selected" : ""}>${pt}</option>`).join("");
    };

    return fetch("./api/get-post-types.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            const types = (json && json.post_types) || [];
            if (!types.length) { fallback(); return; }
            const known = types.some(t => t.name === wanted);
            sel.innerHTML = types.map(t =>
                `<option value="${escapeHtml(t.name)}"${t.name === wanted ? " selected" : ""}>${escapeHtml(t.name)} · ${t.total}</option>`
            ).join("");
            if (!known) sel.value = types[0].name;
        })
        .catch(err => { console.error(err); fallback(); });
}

/* ---------- CATEGORIES ---------- */
function loadPostCategories() {
    const currentDb = currentConn();
    document.getElementById('db-select').value = currentDb;
    const fd = new FormData();
    fd.append("conn", currentDb);

    const sel = document.getElementById('postcat');

    return fetch("./api/get-post-cat.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            sel.innerHTML = `<option value="">All categories</option>`;
            (json.categories || []).forEach(pc => {
                sel.innerHTML += `<option value="${escapeHtml(pc.name)}"${pc.name === activeKeyword ? " selected" : ""}>${escapeHtml(pc.name)} - ${pc.count}</option>`;
            });
        })
        .catch(err => { toast("Failed to load categories", "error"); console.error(err); });
}

/* ============================================================
   MAIN POSTS TABLE
   ============================================================ */
let dataTable = null;
let allRows = [];

const COLS = [
    { key: "no", label: "#" },
    { key: "id", label: "ID" },
    { key: "url", label: "Original URL", locked: true },
    { key: "slug", label: "Post Name" },
    { key: "categories", label: "Category" },
    { key: "post_status", label: "Status" },
    { key: "post_date", label: "Published" },
    { key: "post_modified", label: "Last Modified" },
    { key: "focus_keyword", label: "Focus Keyword" },
];
const COLS_KEY = "fk-hidden-cols";

function hiddenCols() {
    try { return JSON.parse(localStorage.getItem(COLS_KEY)) || []; }
    catch (e) { return []; }
}
function setHiddenCols(arr) { localStorage.setItem(COLS_KEY, JSON.stringify(arr)); }

function buildColsMenu() {
    const hidden = hiddenCols();
    document.getElementById("colsList").innerHTML = COLS.map((c, i) => `
        <label class="drop-check${c.locked ? " locked" : ""}">
            <input type="checkbox" data-col="${i}" ${hidden.includes(i) ? "" : "checked"} ${c.locked ? "disabled" : ""}>
            <span>${escapeHtml(c.label)}</span>
        </label>`).join("");
}

document.getElementById("colsList").addEventListener("change", e => {
    const cb = e.target.closest("input[data-col]");
    if (!cb || !dataTable) return;
    const idx = parseInt(cb.dataset.col, 10);
    const hidden = hiddenCols().filter(i => i !== idx);
    if (!cb.checked) hidden.push(idx);
    setHiddenCols(hidden);
    dataTable.column(idx).visible(cb.checked);
});

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

function idChip(id) {
    const href = wpEditUrl(id);
    return href
        ? `<a class="id-chip" href="${href}" target="_blank" rel="noopener noreferrer" title="Open #${id} in the WordPress editor">${id}</a>`
        : `<span class="id-chip">${id}</span>`;
}

function statusBadge(s) {
    const known = ["publish", "draft", "trash", "pending", "private"];
    const cls = known.includes(s) ? `status-${s}` : "status-private";
    return `<span class="status-badge ${cls}">${escapeHtml(s || "—")}</span>`;
}

function loadPosts() {
    showLoading("Fetching posts…");
    const pt = document.getElementById("posttype").value || "post";
    const ps = document.getElementById("poststatus").value || "publish";
    const pc = document.getElementById("postcat").value;
    const onlyDup = onlyDupCb.checked ? 1 : 0;
    const currentDb = currentConn();
    document.getElementById('db-select').value = currentDb;

    localStorage.setItem(prefKey("post_type"), pt);
    localStorage.setItem(prefKey("post_status"), ps);

    const fd = new FormData();
    fd.append("post_type", pt);
    fd.append("post_status", ps);
    fd.append("only_duplicate", onlyDup);
    fd.append("conn", currentDb);
    fd.append("category", pc);

    if (dataTable) { dataTable.clear().destroy(); dataTable = null; }
    document.querySelector("#postTable tbody").innerHTML = "";
    activeFocusKw = "";
    kwPresence = "";
    applyKeywordFilter(""); // reset any active category filter on reload
    kwPanel.hidden = true;

    const t0 = performance.now();

    return fetch("./api/get-posts.php", { method: "POST", body: fd })
        .then(r => { if (r.status === 401) { window.location.href = "./login.php"; throw new Error("unauthenticated"); } return r.json(); })
        .then(json => {
            const totalMs = performance.now() - t0;
            hideLoading();

            if (json.status !== "success") {
                toast(json.error || "Server error", "error");
                return;
            }

            setSiteHome(json.site_home);

            const rows = (json.data || []).map((r, i) => ({
                no: i + 1,
                id: r.ID,
                slug: r.post_name || "",
                title: r.post_title || "",
                url: r.url || "",
                url_source: r.url_source || "",
                url_pretty: r.url_pretty !== false,
                guid: r.guid || "",
                post_type: r.post_type || "",
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

            const hidden = hiddenCols().filter(i => i !== 2 && i >= 0 && i < COLS.length);

            dataTable = $("#postTable").DataTable({
                data: rows,
                lengthMenu: [[10, 25, 50, 100, 200, 300, 500], [10, 25, 50, 100, 200, 300, 500]],
                pageLength: parseInt(localStorage.getItem("fk-page-length"), 10) || 100,
                autoWidth: false,
                deferRender: true,
                dom: "<'dataTables_top'lf>rtip",
                language: {
                    search: "", searchPlaceholder: "Search URL, title, slug, keyword…",
                    lengthMenu: "Show _MENU_ per page",
                    info: "_START_–_END_ of _TOTAL_ posts",
                    infoEmpty: "No posts found",
                    infoFiltered: "(filtered from _MAX_)",
                    zeroRecords: "No matching posts found",
                },
                order: [],
                columns: [
                    { data: "no", title: "#", orderable: false, width: "42px", render: data => `<span class="cell-no">${data}</span>` },
                    { data: "id", title: "ID", orderable: false, width: "64px", render: data => idChip(data) },
                    {
                        data: "url", title: "Original URL", width: "34%",
                        render: function (data, type, row) {
                            if (type === "filter") return `${data || ""} ${row.title || ""} ${row.slug || ""}`;
                            if (type === "sort" || type === "export") return data || "";
                            return urlCell(row);
                        }
                    },
                    { data: "slug", title: "Post Name", width: "16%", render: (data, type) => type === "display" ? (data ? `<span class="cell-slug">${escapeHtml(data)}</span>` : `<span class="no-kw">—</span>`) : (data || "") },
                    { data: "categories", title: "Category", width: "12%", render: (data, type) => type === "display" ? (data ? `<button class="cat-chip" data-cat="${escapeHtml(data)}" title="Click to isolate this category">${escapeHtml(data)}</button>` : `<span class="no-kw">—</span>`) : (data || "") },
                    { data: "post_status", title: "Status", width: "96px", render: (data, type) => type === "display" ? (data ? statusBadge(data) : `<span class="cell-muted">—</span>`) : (data || "") },
                    { data: "post_date", title: "Published", width: "104px", render: (data, type) => type === "display" ? (data ? `<span class="cell-date">${fmtDate(data)}</span>` : `<span class="cell-muted">—</span>`) : (data || "") },
                    { data: "post_modified", title: "Last Modified", width: "104px", render: (data, type) => type === "display" ? (data ? `<span class="cell-date">${fmtDate(data)}</span>` : `<span class="cell-muted">—</span>`) : (data || "") },
                    {
                        data: "focus_keyword", title: "Focus Keyword", width: "15%",
                        render: (data, type, row) => type === "display"
                            ? (data ? `<button type="button" class="kw-badge${row.duplicate ? " kw-dup" : ""}" data-kw="${escapeHtml(data)}" title="Click to isolate every post using this keyword">${escapeHtml(data)}</button>` : `<span class="no-kw">—</span>`)
                            : (data || "")
                    }
                ],
                columnDefs: hidden.length ? [{ targets: hidden, visible: false }] : [],
                createdRow(row, rowData) {
                    if (rowData.duplicate && rowData.focus_keyword) {
                        const k = rowData.focus_keyword.toLowerCase().trim();
                        if (colorMap[k]) row.classList.add(`dup-group-${colorMap[k]}`);
                    }
                },
                scrollX: true,
                responsive: false,
            });

            dataTable.on("length.dt", (e, settings, len) => localStorage.setItem("fk-page-length", len));

            buildColsMenu();
            renderChips();

            /* click a category to isolate it */
            $("#postTable tbody").off("click", ".cat-chip").on("click", ".cat-chip", function (e) {
                e.stopPropagation();
                filterCategory(this.dataset.cat);
            });

            /* click a focus keyword to isolate every post using it */
            $("#postTable tbody").off("click", ".kw-badge").on("click", ".kw-badge", function (e) {
                e.stopPropagation();
                const kw = this.dataset.kw;
                applyFocusKeywordFilter(activeFocusKw.toLowerCase() === kw.toLowerCase() ? "" : kw);
            });
        })
        .catch(err => { hideLoading(); toast("Failed to load posts", "error"); console.error(err); });
}

function filterCategory(cat) {
    applyKeywordFilter(activeKeyword.toLowerCase() === (cat || "").toLowerCase() ? "" : cat);
    document.getElementById("postcat").value = activeKeyword ? cat : "";
}

/* ---------- EXPORT ---------- */
function rowsToCSV(rows) {
    let csv = "No,ID,Original URL,Post Title,Post Name,Category,Status,Published,Last Modified,Focus Keyword,Duplicate\n";
    rows.forEach(r => {
        csv += [
            escCSV(r.no), escCSV(r.id), escCSV(r.url), escCSV(r.title), escCSV(r.slug),
            escCSV(r.categories), escCSV(r.post_status), escCSV(fmtDate(r.post_date)), escCSV(fmtDate(r.post_modified)),
            escCSV(r.focus_keyword), escCSV(r.duplicate ? "yes" : "no")
        ].join(",") + "\n";
    });
    return csv;
}

function visibleRows() {
    return dataTable ? dataTable.rows({ search: "applied" }).data().toArray() : [];
}

document.getElementById("exportCSV").addEventListener("click", () => {
    closeMenus();
    const rows = visibleRows();
    if (!rows.length) return toast("No rows to export", "info");
    downloadCSV(rowsToCSV(rows), "visible-rows.csv");
    toast(`Exported ${rows.length} rows`, "success");
});

document.getElementById("exportOnlyDup").addEventListener("click", () => {
    closeMenus();
    const rows = allRows.filter(d => d.duplicate);
    if (!rows.length) return toast("No duplicate rows found", "info");
    downloadCSV(rowsToCSV(rows), "duplicates-only.csv");
    toast(`Exported ${rows.length} duplicate rows`, "success");
});

document.getElementById("exportGrouped").addEventListener("click", () => {
    closeMenus();
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

document.getElementById("copyUrls").addEventListener("click", () => {
    closeMenus();
    const urls = visibleRows().map(r => r.url).filter(Boolean);
    if (!urls.length) return toast("No URLs to copy", "info");
    copyText(urls.join("\n"))
        .then(() => toast(`Copied ${urls.length} URL${urls.length === 1 ? "" : "s"}`, "success"))
        .catch(() => toast("Could not copy", "error"));
});

document.getElementById("copyIds").addEventListener("click", () => {
    closeMenus();
    const ids = visibleRows().map(r => r.id);
    if (!ids.length) return toast("No IDs to copy", "info");
    copyText(ids.join(", "))
        .then(() => toast(`Copied ${ids.length} ID${ids.length === 1 ? "" : "s"}`, "success"))
        .catch(() => toast("Could not copy", "error"));
});

/* ---------- REFRESH / CONTROLS ---------- */
document.getElementById("refreshTable").addEventListener("click", () => loadPosts());
document.getElementById("posttype").addEventListener("change", () => loadPosts());
document.getElementById("poststatus").addEventListener("change", () => loadPosts());
document.getElementById("postcat").addEventListener("change", e => filterCategory(e.target.value));

/* ---------- SIDEBAR NAV ---------- */
document.getElementById("navPosts")?.addEventListener("click", e => {
    e.preventDefault();
    document.getElementById("postsCard").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("navDuplicates")?.addEventListener("click", e => {
    e.preventDefault();
    onlyDupCb.checked = !onlyDupCb.checked;
    onlyDupCb.dispatchEvent(new Event("change"));
});

/* ---------- KEYBOARD SHORTCUTS ---------- */
document.addEventListener("keydown", e => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";

    if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector("#postTable_wrapper .dataTables_filter input")?.focus();
        return;
    }
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.querySelector("#postTable_wrapper .dataTables_filter input")?.focus();
        return;
    }
    if (e.key === "Escape") {
        closeMenus();
        if (typing && e.target.matches("#postTable_wrapper .dataTables_filter input")) {
            e.target.value = "";
            dataTable?.search("").draw();
            e.target.blur();
            return;
        }
        if (!typing) clearAllFilters();
    }
});

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('db-select').value = currentConn();

    const savedStatus = localStorage.getItem(prefKey("post_status"));
    if (savedStatus) {
        const sel = document.getElementById("poststatus");
        if ([...sel.options].some(o => o.value === savedStatus)) sel.value = savedStatus;
    }

    buildColsMenu();
    loadPostCategories();
    loadPostTypes().then(loadPosts);
});
