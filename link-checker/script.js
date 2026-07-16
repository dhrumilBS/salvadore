/* ---------- UTILS ---------- */
function escapeHtml(t) {
    return (t || "").replace(/[&<>"]/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

function escCSV(v) {
    if (!v) return "";
    v = String(v);
    return (v.includes(",") || v.includes('"') || v.includes("\n"))
        ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCSV(csv, fn) {
    const b = new Blob([csv], { type: "text/csv" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = fn; a.click();
    URL.revokeObjectURL(u);
}

function showLoading(msg = "Loading…") {
    document.getElementById("loadingText").textContent = msg;
    document.getElementById("loadingOverlay").classList.add("show");
}

function hideLoading() {
    document.getElementById("loadingOverlay").classList.remove("show");
}

function toast(msg, type = "info", duration = 3000) {
    const c = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-dot"></div><span>${msg}</span>`;
    c.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 300); }, duration);
}

/* ---------- LINK EXTRACTION ---------- */
function extractLinks(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    return [...doc.querySelectorAll("a")].map(a => {
        const href = a.href || "";
        const isUtm = /[?&]utm_/i.test(href);
        let utmParams = [];
        if (isUtm) {
            try {
                const u = new URL(href);
                utmParams = [...u.searchParams.entries()]
                    .filter(([k]) => k.startsWith("utm_"))
                    .map(([k, v]) => `${k}=${v}`);
            } catch (e) { }
        }
        return {
            link: href,
            anchor: a.textContent.trim(),
            isUtm,
            utmParams
        };
    });
}

/* ---------- STATS ---------- */
function updateStats(rows) {

}

/* ---------- DB SWITCHER ---------- */
const DB_KEY = "linkInspector_sites";
const DB_ACTIVE_KEY = "linkInspector_activeSite";

async function getSites() {
    try {
        const res = await fetch("./api/get_sites");
        const json = await res.json();

        return Array.isArray(json.data)
            ? json.data
            : [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

function getActiveSite() {
    const saved = localStorage.getItem(DB_ACTIVE_KEY);
    return saved ? JSON.parse(saved) : null;
}
function setActiveSite(site) {
    localStorage.setItem(DB_ACTIVE_KEY, JSON.stringify(site));
    const pill = document.getElementById("activeSitePill");
    const label = document.getElementById("activeSiteLabel");
    if (site) {
        label.textContent = site.label || site.dbName || "Unnamed Site";
        pill.style.borderColor = "rgba(57,211,83,.4)";
    } else {
        label.textContent = "Select Site";
        pill.style.borderColor = "";
    }
}

async function renderSavedSites() {
    const list = document.getElementById("savedSitesList");
    const sites = await getSites();
    const postStatus = await getSites();
    console.log(sites);

    const active = getActiveSite();

    if (!sites.length) {
        list.innerHTML = ` <div class="empty-sites"> No sites found </div>`;
        return;
    }

    list.innerHTML = sites.map((site, i) => {
        const isActive = active && active && active.key === site.key;
        return `<div class="saved-site-item ${isActive ? "active-site" : ""}" data-idx="${i}">
                <span class="saved-site-dot"></span>
                <div>
                    <div class="saved-site-name"> ${escapeHtml(site.label || site.key || "Unnamed")} </div>
                    <div class="saved-site-db"> ${escapeHtml(site.key || "")} </div>
                </div>
            </div>`;
    }).join("");

    list.querySelectorAll(".saved-site-item").forEach(el => {
        el.addEventListener("click", async () => {
            const idx = parseInt(el.dataset.idx);
            const site = sites[idx];
            if (!site) return;
            setActiveSite(site);
            toast(`Connected to ${site.label || site.key}`, "success");
            closeModal();
            await loadPostTypes();
            loadPosts();
        });
    });
}

function openModal() { document.getElementById("dbModal").classList.add("open"); renderSavedSites(); }
function closeModal() { document.getElementById("dbModal").classList.remove("open"); }

document.getElementById("openDbModal").addEventListener("click", openModal);
document.getElementById("closeModal").addEventListener("click", closeModal);

document.getElementById("dbModal").addEventListener("click", function (e) {
    if (e.target === this) closeModal();
});

/* ---------- EXPORT DROPDOWN ---------- */
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");

exportBtn.addEventListener("click", e => {
    e.stopPropagation();
    exportMenu.classList.toggle("open");
});

document.addEventListener("click", () => exportMenu.classList.remove("open"));
exportMenu.addEventListener("click", e => e.stopPropagation());

/* Export: all visible rows */
document.getElementById("exportAllCSV").addEventListener("click", () => {
    if (!dataTable) { toast("No data to export", "warn"); return; }

    const visibleData = dataTable.rows({ search: "applied" }).data().toArray();
    const header = ["#", "ID", "Slug", "Post Title", "Published", "Total Links", "UTM Links", "Links"];
    const rows = visibleData.map(r => [
        r.no, r.id, r.slug,
        r.title_plain,
        r.post_date ? r.post_date.split(" ")[0] : "",
        r.links.length,
        r.links.filter(l => l.isUtm).length,
        r.links.map(l => l.link).join(" | ")
    ].map(escCSV).join(","));

    downloadCSV([header.join(","), ...rows].join("\n"), "links-all.csv");
    toast("Exported visible rows", "success");
    exportMenu.classList.remove("open");
});

/* Export: UTM links only */
document.getElementById("exportUtmCSV").addEventListener("click", () => {
    if (!dataTable) { toast("No data to export", "warn"); return; }

    const header = ["Post ID", "Slug", "Post Title", "Published", "Link URL", "Anchor Text", "UTM Params"];
    const rows = [];

    dataTable.rows({ search: "applied" }).data().toArray().forEach(r => {
        r.links.filter(l => l.isUtm).forEach(l => {
            rows.push([
                r.id, r.slug, r.title_plain,
                r.post_date ? r.post_date.split(" ")[0] : "",
                l.link, l.anchor,
                l.utmParams.join(" | ")
            ].map(escCSV).join(","));
        });
    });

    if (!rows.length) { toast("No UTM links found in visible rows", "warn"); return; }
    downloadCSV([header.join(","), ...rows].join("\n"), "utm-links.csv");
    toast(`Exported ${rows.length} UTM link(s)`, "success");
    exportMenu.classList.remove("open");
});

/* Export: all links flat */
document.getElementById("exportLinksFlat").addEventListener("click", () => {
    if (!dataTable) { toast("No data to export", "warn"); return; }

    const header = ["Post ID", "Slug", "Post Title", "Published", "Link URL", "Anchor Text", "Has UTM", "UTM Params"];
    const rows = [];

    dataTable.rows({ search: "applied" }).data().toArray().forEach(r => {
        r.links.forEach(l => {
            rows.push([
                r.id, r.slug, r.title_plain,
                r.post_date ? r.post_date.split(" ")[0] : "",
                l.link, l.anchor,
                l.isUtm ? "YES" : "NO",
                l.utmParams.join(" | ")
            ].map(escCSV).join(","));
        });
    });

    if (!rows.length) { toast("No links found in visible rows", "warn"); return; }
    downloadCSV([header.join(","), ...rows].join("\n"), "all-links-flat.csv");
    toast(`Exported ${rows.length} link(s)`, "success");
    exportMenu.classList.remove("open");
});

/* ---------- LOAD POST TYPES ---------- */
async function loadPostStatus() {
    try {
        const res = await fetch("./api/get_post_status");
        const json = await res.json();
        const sel = document.getElementById("poststatus");
        sel.innerHTML = `<option value="">Select Status</option>`;

        sel.innerHTML = Object.entries(json.data)
            .map(([key, value]) => `<option value="${key}">${value}</option>`)
            .join('');
    } catch (e) {
        console.error(e);
        return [];
    }
}

/* ---------- LOAD POST TYPES ---------- */
async function loadPostTypes() {
    const active = getActiveSite();
    const fd = new FormData();
    if (active?.key) {
        fd.append("db_key", active.key);
    }
    try {
        const res = await fetch("./api/get_post_types", { method: "POST", body: fd });
        const json = await res.json();
        const sel = document.getElementById("posttype");
        sel.innerHTML = `<option value="">Select type</option>`;
        (json.post_types || []).forEach(pt => {
            sel.innerHTML += `<option value="${pt}"> ${pt} </option>`;
        });
    } catch (err) {
        console.error(err);
    }
}

/* ---------- LOAD POST ---------- */
function loadPosts() {
    showLoading("Fetching posts…");

    const pt = document.getElementById("posttype").value || "post";
    const ps = document.getElementById("poststatus").value || "publish";
    const active = getActiveSite();
    const fd = new FormData();

    fd.append("post_type", pt);
    fd.append("post_status", ps);

    if (active?.key) {
        fd.append("db_key", active.key);
    }

    if (dataTable) { dataTable.clear().destroy(); dataTable = null; }
    document.querySelector("#postTable tbody").innerHTML = "";
    $.fn.dataTable.ext.search = [];

    fetch("./api/get_posts", { method: "POST", body: fd })
        .then(r => r.json())
        .then(json => {
            hideLoading();
            const posts = Array.isArray(json.data) ? json.data : [];

            const rows = posts.map((r, i) => {
                const links = extractLinks(r.post_content || "");
                return {
                    no: i + 1,
                    id: r.ID,
                    slug: r.post_name || "",
                    title_plain: r.post_title || "",
                    title_html: r.post_title
                        ? `<a class="post-link" href="${escapeHtml(r.guid)}" target="_blank">${escapeHtml(r.post_title)}</a>`
                        : "—",
                    post_status: r.post_status || "",
                    post_date: r.post_date || "",
                    links
                };
            });

            allRows = rows;
            const totalLinks = rows.reduce((s, r) => s + r.links.length, 0);
            const totalUtm = rows.reduce((s, r) => s + r.links.filter(l => l.isUtm).length, 0);
            const postsUtm = rows.filter(r => r.links.some(l => l.isUtm)).length;

            document.getElementById("statTotal").textContent = rows.length.toLocaleString();
            document.getElementById("statLinks").textContent = totalLinks.toLocaleString();
            document.getElementById("statUtm").textContent = totalUtm.toLocaleString();
            document.getElementById("statPostsUtm").textContent = postsUtm.toLocaleString();

            dataTable = $("#postTable").DataTable({
                data: rows,
                lengthMenu: [
                    [10, 25, 50, 100, 200, 500],
                    [10, 25, 50, 100, 200, 500]
                ],
                pageLength: 100,
                dom: "<'dataTables_top'lf>rtip",
                // language: {
                //     search: "",
                //     searchPlaceholder: "Search posts, slugs…",
                //     lengthMenu: "Show _MENU_ per page",
                //     info: "_START_–_END_ of _TOTAL_ posts",
                //     infoEmpty: "No posts found",
                //     zeroRecords: "No matching posts",
                // },
                columns: [
                    { data: "no", title: "#", className: "no-sort", orderable: false, render: v => `<span style="color:var(--text3);font-family:var(--mono);font-size:11px">${v}</span>` },
                    { data: "id", title: "ID", render: v => `<span class="id-chip">${v}</span>` },
                    { data: "slug", title: "Slug", render: v => v ? `<span style="font-family:var(--mono);font-size:11px;color:var(--text2)">${escapeHtml(v)}</span>` : `<span style="color:var(--text3);font-style:italic;font-size:12px">—</span>` },
                    { data: "title_html", title: "Post Title" },
                    { data: "post_status", title: "Status" },
                    { data: "post_date", title: "Published", render: v => v ? `<span class="date-text">${v.split(" ")[0]}</span>` : "—" },
                    { data: "links", title: "Links Found", orderable: false, render: (links) => renderLinks(links) }],
                createdRow: (row, data) => {
                    if (data.links.some(l => l.isUtm)) {
                        row.classList.add("has-utm");
                    }
                },
                scrollX: true,
                responsive: false,
            });
        })
        .catch(err => {
            hideLoading();
            toast("Failed to load posts", "error");
            console.error(err);
        });
}

/* ---------- RENDER LINK CELL ---------- */
function renderLinks(links) {
    if (!links.length) {
        return `<span class="no-links">No links</span>`;
    }

    const utmCount = links.filter(l => l.isUtm).length;
    const badge = utmCount > 0
        ? `<span class="link-count-badge has-utm">
               <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
               ${links.length} link${links.length !== 1 ? "s" : ""} · ${utmCount} UTM
           </span>`
        : `<span class="link-count-badge">${links.length} link${links.length !== 1 ? "s" : ""}</span>`;

    const rows = links.map(l => {
        const params = l.isUtm && l.utmParams.length
            ? `<div class="utm-params">${l.utmParams.map(p => `<span class="utm-param-tag">${escapeHtml(p)}</span>`).join("")}</div>`
            : "";

        return `
        <div class="link-row ${l.isUtm ? "utm-link" : ""}">
            <div class="link-meta">
                <a href="${escapeHtml(l.link)}" target="_blank" rel="noopener">${escapeHtml(l.link)}</a>
                ${l.isUtm ? `<span class="utm-badge">UTM</span>` : ""}
            </div>
            ${l.anchor ? `<span class="link-anchor">↳ ${escapeHtml(l.anchor)}</span>` : ""}
            ${params}
        </div>`;
    }).join("");

    return `<div class="link-list">${badge}${rows}</div>`;
}

/* ---------- DATATABLES ---------- */
let dataTable = null;
let allRows = [];

/* UTM filter dropdown */
document.getElementById("filterUtm").addEventListener("change", function () {
    if (!dataTable) return;
    $.fn.dataTable.ext.search = [];

    const val = this.value;
    if (val !== "all") {
        $.fn.dataTable.ext.search.push((settings, data, idx) => {
            if (settings.nTable.id !== "postTable") return true;
            const row = dataTable.row(idx).data();
            if (!row) return true;
            if (val === "utm") return row.links.some(l => l.isUtm);
            if (val === "clean") return row.links.length > 0 && !row.links.some(l => l.isUtm);
            if (val === "nolinks") return row.links.length === 0;
            return true;
        });
    }
    dataTable.draw();
});
/* ---------- CONTROLS ---------- */
document.getElementById("refreshTable").addEventListener("click", loadPosts);
document.getElementById("posttype").addEventListener("change", loadPosts);
document.getElementById("poststatus").addEventListener("change", loadPosts);

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
    renderSavedSites();
    loadPostTypes();
    loadPostStatus();
    loadPosts();
});