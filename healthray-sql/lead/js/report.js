document.addEventListener("DOMContentLoaded", () => {

    /* ══════════════════════════════════════
       STATE
    ══════════════════════════════════════ */
    let originalRows = [];
    let allColumns = [];
    let defaultShowCols = [];
    let filteredRows = [];
    let dupMeta = {};
    let visibleCols = new Set();

    /* Active filters - all stack together */
    let activeDupFilter = null;  // null | 'email' | 'phone' | 'time'
    let activeCampaignFilter = null;  // exact string | null
    let activeSourceFilter = null;  // exact string | null
    let activeDateFilter = null;  // exact string | null
    let activePageFilter = null;  // exact string | null
    let activeAdtypeFilter = null;  // 'Organic' | 'Ads' | null

    /* Accordion open state - persisted across re-renders */
    const breakdownOpen = { campaign: false, source: false, date: false, page: false, adtype: false };

    /* ══════════════════════════════════════
       DATE DEFAULTS
    ══════════════════════════════════════ */
    const today = new Date();
    const fromDate = new Date();
    fromDate.setDate(today.getDate() - 2);
    document.getElementById("from").value = fmt(fromDate);
    document.getElementById("to").value = fmt(today);
    function fmt(d) { return d.toISOString().split("T")[0]; }

    /* ══════════════════════════════════════
       DOM REFS
    ══════════════════════════════════════ */
    const loaderWrap = document.getElementById("loaderWrap");
    const tableHead = document.getElementById("tableHead");
    const tableBody = document.getElementById("tableBody");
    const tableSearch = document.getElementById("tableSearch");
    const emptyState = document.getElementById("emptyState");
    const mainTable = document.getElementById("mainTable");
    const statusBadge = document.getElementById("statusBadge");
    const colPills = document.getElementById("colPills");
    const colSelectorHdr = document.getElementById("colSelectorHdr");
    const filterStrip = document.getElementById("filterStrip");
    const filterStripLbl = document.getElementById("filterStripLabel");

    /* ══════════════════════════════════════
       COLUMN SELECTOR
    ══════════════════════════════════════ */
    colSelectorHdr.addEventListener("click", e => {
        if (e.target.closest("#colSelectorActions")) return;
        colSelectorHdr.classList.toggle("open");
        colPills.classList.toggle("visible");
    });
    document.getElementById("btnShowAll").addEventListener("click", e => {
        e.stopPropagation();
        allColumns.forEach(c => visibleCols.add(c));
        applyVisibility();
    });
    document.getElementById("btnHideAll").addEventListener("click", e => {
        e.stopPropagation();
        visibleCols.clear();
        applyVisibility();
    });
    document.getElementById("btnReset").addEventListener("click", e => {
        e.stopPropagation();
        visibleCols = new Set(defaultShowCols);
        applyVisibility();
    });

    /* ══════════════════════════════════════
       FORM / SEARCH
    ══════════════════════════════════════ */
    document.getElementById("filterForm").addEventListener("submit", e => {
        e.preventDefault();
        loadData();
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
        document.getElementById("from").value = fmt(fromDate);
        document.getElementById("to").value = fmt(today);
        tableSearch.value = "";
        clearAllFilters();
        loadData();
    });
    tableSearch.addEventListener("input", applyFilters);
    document.getElementById("dbSelect").addEventListener("change", () => {
        clearAllFilters();
        loadData();
    });

    /* ══════════════════════════════════════
       DUP FILTER CARDS
    ══════════════════════════════════════ */
    document.getElementById("cardDupEmail").addEventListener("click", () => toggleDupFilter("email"));
    document.getElementById("cardDupPhone").addEventListener("click", () => toggleDupFilter("phone"));
    document.getElementById("cardDupTime").addEventListener("click", () => toggleDupFilter("time"));
    document.getElementById("clearDupFilter").addEventListener("click", () => { clearAllFilters(); applyFilters(); });

    /* ══════════════════════════════════════
       EXPORT MENU
    ══════════════════════════════════════ */
    const exportBtn = document.getElementById("exportBtn");
    const exportMenu = document.getElementById("exportMenu");
    exportBtn.addEventListener("click", e => { e.stopPropagation(); exportMenu.classList.toggle("open"); });
    document.addEventListener("click", () => exportMenu.classList.remove("open"));
    document.getElementById("exportCSV").addEventListener("click", () => {
        exportMenu.classList.remove("open"); doExportCSV(filteredRows, false);
    });
    document.getElementById("exportJSON").addEventListener("click", () => {
        exportMenu.classList.remove("open"); doExportJSON(filteredRows);
    });
    document.getElementById("exportDupCSV").addEventListener("click", () => {
        exportMenu.classList.remove("open");
        const dupRows = originalRows.filter((_, i) => dupMeta[i]?.email || dupMeta[i]?.phone || dupMeta[i]?.time);
        if (!dupRows.length) { showToast("No duplicate rows found", "error"); return; }
        doExportCSV(dupRows, true);
    });

    /* INITIAL LOAD */
    loadData();

    /* FETCH */
    async function loadData() {
        showLoader(true);
        statusBadge.textContent = "Loading…";
        try {
            const res = await fetch("./../api/get_report.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    db: document.getElementById("dbSelect").value,
                    from: document.getElementById("from").value,
                    to: document.getElementById("to").value,
                })
            });
            if (!res.ok) throw new Error(`Server error - HTTP ${res.status}`);
            const data = await res.json();
            if (data.status !== "success") throw new Error(data.error || "API returned an error");
            renderAll(data);
            if (data.truncated) {
                showToast(`Showing first ${data.limit.toLocaleString()} rows - narrow the date range to see all`, "error");
                statusBadge.textContent = "Truncated";
            } else {
                showToast(`Loaded ${(data.rows || []).length} rows`, "success");
                statusBadge.textContent = "Live";
            }
        } catch (err) {
            console.error(err);
            showToast(err.message, "error");
            statusBadge.textContent = "Error";
        } finally {
            showLoader(false);
        }
    }

    /* DUPLICATE ANALYSIS */
    function analyseDuplicates(rows) {
        const meta = {};
        rows.forEach((_, i) => (meta[i] = { email: false, phone: false, time: false }));
        const emailMap = buildFreqMap(rows, r => norm(r["your-email"]));
        const phoneMap = buildFreqMap(rows, r => norm(r["your-number"]));
        const timeMap = buildFreqMap(rows, r => norm(r["submit_time"]));
        rows.forEach((row, i) => {
            const e = norm(row["your-email"]);
            const p = norm(row["your-number"]);
            const t = norm(row["submit_time"]);
            if (e && emailMap[e] > 1) meta[i].email = true;
            if (p && phoneMap[p] > 1) meta[i].phone = true;
            if (t && timeMap[t] > 1) meta[i].time = true;
        });
        return meta;
    }
    function buildFreqMap(rows, fn) {
        const m = {};
        rows.forEach(r => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; });
        return m;
    }
    function norm(v) { return (v == null || v === "") ? null : String(v).trim().toLowerCase(); }

    /* BREAKDOWN HELPERS
       extractUtmVal  - resolve UTM param from raw column value
       getRowDate     - extract YYYY-MM-DD from a row's time fields
     */
    function extractUtmVal(raw, colName) {
        if (raw == null || raw === "") return "";
        try {
            const url = new URL(String(raw));
            const param = url.searchParams.get(colName);
            return param != null ? param : String(raw);
        } catch { return String(raw); }
    }

    function getRowDate(row) {
        const t = row["submit_time"] || row["submitted_from"] || "";
        if (!t) return "(unknown)";
        const m = String(t).match(/\d{4}-\d{2}-\d{2}/);
        return m ? m[0] : String(t).slice(0, 10) || "(unknown)";
    }

    /* Page the form was submitted from - shown as the URL path (e.g. "/emr-software/") */
    function getPageName(row) {
        const raw = row["page-name"] || row["handl_url_cf7-264"] || "";
        if (!raw) return "(unknown)";
        try {
            const path = new URL(String(raw)).pathname;
            return path === "" || path === "/" ? "(home)" : path;
        } catch { return String(raw); }
    }

    /* Organic (no ad platform) vs Ads (utm_medium=cpc from Google/Facebook Ads etc.) */
    function getAdType(row) {
        const medium = extractUtmVal(row["utm_medium"], "utm_medium").trim().toLowerCase();
        return medium === "cpc" ? "Ads" : "Organic";
    }

    /* Build [{ value, count }] from a set of rows for a given dimension */
    function buildBreakdown(rows, dimension) {
        const map = {};
        rows.forEach(row => {
            let key;
            if (dimension === "date") {
                key = getRowDate(row);
            } else if (dimension === "page") {
                key = getPageName(row);
            } else if (dimension === "adtype") {
                key = getAdType(row);
            } else {
                /* utm_campaign or utm_source */
                const raw = row[dimension];
                const val = extractUtmVal(raw, dimension);
                key = val.trim() || "(none)";
            }
            map[key] = (map[key] || 0) + 1;
        });

        const entries = Object.entries(map).map(([value, count]) => ({ value, count }));

        if (dimension === "date") {
            // Sort newest first
            entries.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
        } else {
            entries.sort((a, b) => b.count - a.count);
        }
        return entries;
    }

    /* RENDER ALL  (called once per loadData) */
    function renderAll(data) {
        allColumns = data.allColumns || [];
        originalRows = data.rows || [];
        defaultShowCols = data.defaultShow || allColumns;
        dupMeta = analyseDuplicates(originalRows);

        if (visibleCols.size === 0) visibleCols = new Set(defaultShowCols);

        console.log(defaultShowCols);
        
        buildPills();
        renderHead();
        filteredRows = [...originalRows];
        renderBody();
        refreshStats();          // stat cards + breakdown cards
        updatePagination();
    }

    /* ════════════════════════════════════════════════════════
       REFRESH STATS
       Called after EVERY filter change so breakdown counts
       always reflect the current filteredRows.
    ════════════════════════════════════════════════════════ */
    function refreshStats() {
        /* Summary row */
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;

        document.getElementById("statTotal").textContent = originalRows.length;
        document.getElementById("statShowing").textContent = filteredRows.length;
        document.getElementById("statRange").textContent = `${fromVal} → ${toVal}`;
        document.getElementById("tableHdrMeta").textContent = `${fromVal} to ${toVal}`;

        const dupEmailCount = originalRows.filter((_, i) => dupMeta[i]?.email).length;
        const dupPhoneCount = originalRows.filter((_, i) => dupMeta[i]?.phone).length;
        const dupTimeCount = originalRows.filter((_, i) => dupMeta[i]?.time).length;
        document.getElementById("statDupEmail").textContent = dupEmailCount;
        document.getElementById("statDupPhone").textContent = dupPhoneCount;
        document.getElementById("statDupTime").textContent = dupTimeCount;

        /* Breakdown cards - ALWAYS computed from filteredRows so counts
           update reactively when other filters are active.
           e.g. source=google selected → campaign card shows only google rows */
        refreshBreakdownCard("bc-campaign", "utm_campaign", "campaign", activeCampaignFilter);
        refreshBreakdownCard("bc-source", "utm_source", "source", activeSourceFilter);
        refreshBreakdownCard("bc-date", "date", "date", activeDateFilter);
        refreshBreakdownCard("bc-page", "page", "page", activePageFilter);
        refreshBreakdownCard("bc-adtype", "adtype", "adtype", activeAdtypeFilter);
    }

    /* ════════════════════════════════════════════════════════
       REFRESH BREAKDOWN CARD
       Re-renders list items from current filteredRows.
       Preserves accordion open/closed state.
       Does NOT re-attach the header accordion listener
       (that's wired once in initBreakdownCards).
    ════════════════════════════════════════════════════════ */
    function refreshBreakdownCard(cardId, dimension, filterKey, activeVal) {
        const card = document.getElementById(cardId);
        const list = card.querySelector(".breakdown-list");
        const total = card.querySelector(".breakdown-total");
        const uniq = card.querySelector(".breakdown-unique");

        /* Compute breakdown from the CURRENT filteredRows */
        const items = buildBreakdown(filteredRows, dimension);
        const sumCount = filteredRows.length;
        const maxCount = items[0]?.count || 1;
        total.textContent = sumCount;
        uniq.textContent = `${items.length} unique`;

        /* Render list rows */
        list.innerHTML = items.map(({ value, count }) => {
            /* Bar width = share of the largest bucket (visual comparison within card) */
            const pct = Math.round((count / sumCount) * 100);
            const isNone = value === "(none)" || value === "(unknown)";
            const isAct = value === activeVal;

            return `<div class="breakdown-item${isAct ? " active" : ""}"
                         data-filter-key="${filterKey}"
                         data-value="${esc(value)}">
                        <span class="bi-label">${isNone ? `<em>${value}</em>` : esc(value)}</span>
                        <div class="bi-bar-wrap"><div class="bi-bar" style="width:${pct}%"></div></div>
                        <span class="bi-count">${count}</span>
                    </div>`;
        }).join("");

        /* Re-attach item click listeners */
        list.querySelectorAll(".breakdown-item").forEach(item => {
            item.addEventListener("click", () => onBreakdownItemClick(item, filterKey, list));
        });

        /* Restore open state (don't collapse just because list re-rendered) */
        list.classList.toggle("open", breakdownOpen[filterKey]);
    }

    /* Single click handler for breakdown list items */
    function onBreakdownItemClick(item, filterKey, list) {
        const val = item.dataset.value;

        /* Toggle the filter for this key */
        if (filterKey === "campaign") activeCampaignFilter = activeCampaignFilter === val ? null : val;
        if (filterKey === "source") activeSourceFilter = activeSourceFilter === val ? null : val;
        if (filterKey === "date") activeDateFilter = activeDateFilter === val ? null : val;
        if (filterKey === "page") activePageFilter = activePageFilter === val ? null : val;
        if (filterKey === "adtype") activeAdtypeFilter = activeAdtypeFilter === val ? null : val;

        updateFilterStrip();

        /* Apply all filters → this rebuilds filteredRows, then refreshes all cards */
        applyFilters();
    }

    /* ════════════════════════════════════════════════════════
       INIT BREAKDOWN ACCORDION HEADERS  (called once)
       We wire the accordion toggle here, never inside
       refreshBreakdownCard, so it never gets double-wired.
    ════════════════════════════════════════════════════════ */

    /* ════════════════════════════════════════════════════════
       FILTER STRIP
    ════════════════════════════════════════════════════════ */
    const dupLabels = { email: "Dup Email", phone: "Dup Phone", time: "Same Time" };

    function updateFilterStrip() {
        const parts = [];
        if (activeDupFilter) parts.push(dupLabels[activeDupFilter]);
        if (activeCampaignFilter) parts.push(`Campaign: ${activeCampaignFilter}`);
        if (activeSourceFilter) parts.push(`Source: ${activeSourceFilter}`);
        if (activeDateFilter) parts.push(`Date: ${activeDateFilter}`);
        if (activePageFilter) parts.push(`Page: ${activePageFilter}`);
        if (activeAdtypeFilter) parts.push(`Type: ${activeAdtypeFilter}`);

        if (parts.length === 0) {
            filterStrip.classList.remove("visible");
        } else {
            filterStripLbl.textContent = "Active filters: " + parts.join("  ·  ");
            filterStrip.classList.add("visible");
        }
    }

    /* ════════════════════════════════════════════════════════
       DUP FILTER TOGGLE
    ════════════════════════════════════════════════════════ */
    function toggleDupFilter(type) {
        activeDupFilter = activeDupFilter === type ? null : type;
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.toggle("active-filter", t === activeDupFilter)
        );
        updateFilterStrip();
        applyFilters();
    }

    function clearAllFilters() {
        activeDupFilter = null;
        activeCampaignFilter = null;
        activeSourceFilter = null;
        activeDateFilter = null;
        activePageFilter = null;
        activeAdtypeFilter = null;
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.remove("active-filter")
        );
        updateFilterStrip();
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ════════════════════════════════════════════════════════
       APPLY ALL FILTERS
       Order: text search → dup → source → campaign → date → page → adtype
       All filters are AND-combined (each narrows the set).
       After filtering, breakdown cards re-render from the
       resulting filteredRows so counts are always in sync.
    ════════════════════════════════════════════════════════ */
    function applyFilters() {
        const kw = tableSearch.value.toLowerCase().trim();
        let rows = [...originalRows];

        /* 1. Text search */
        if (kw) {
            rows = rows.filter(row =>
                Object.values(row).some(v => String(v ?? "").toLowerCase().includes(kw))
            );
        }

        /* 2. Duplicate flag */
        if (activeDupFilter) {
            rows = rows.filter(row => {
                const idx = originalRows.indexOf(row);
                return dupMeta[idx]?.[activeDupFilter];
            });
        }

        /* 3. UTM Source */
        if (activeSourceFilter) {
            rows = rows.filter(row => {
                const val = extractUtmVal(row["utm_source"], "utm_source").trim() || "(none)";
                return val === activeSourceFilter;
            });
        }

        /* 4. UTM Campaign */
        if (activeCampaignFilter) {
            rows = rows.filter(row => {
                const val = extractUtmVal(row["utm_campaign"], "utm_campaign").trim() || "(none)";
                return val === activeCampaignFilter;
            });
        }

        /* 5. Date */
        if (activeDateFilter) {
            rows = rows.filter(row => getRowDate(row) === activeDateFilter);
        }

        /* 6. Page Name */
        if (activePageFilter) {
            rows = rows.filter(row => getPageName(row) === activePageFilter);
        }

        /* 7. Organic / Ads */
        if (activeAdtypeFilter) {
            rows = rows.filter(row => getAdType(row) === activeAdtypeFilter);
        }

        filteredRows = rows;
        renderBody();

        /* CRITICAL: refresh breakdown cards from the new filteredRows
           so counts + bars reflect exactly what's shown in the table */
        refreshStats();
        updatePagination();
    }

    /* ════════════════════════════════════════════════════════
       COLUMN PILLS
    ════════════════════════════════════════════════════════ */
    function buildPills() {
        colPills.innerHTML = allColumns.map(col => `
            <span class="col-pill ${visibleCols.has(col) ? "active" : ""}" data-col="${esc(col)}">
                ${formatCol(col)}
            </span>`).join("");

        colPills.querySelectorAll(".col-pill").forEach(pill => {
            pill.addEventListener("click", () => {
                const col = pill.dataset.col;
                if (visibleCols.has(col)) visibleCols.delete(col);
                else visibleCols.add(col);
                applyVisibility();
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       APPLY VISIBILITY
    ════════════════════════════════════════════════════════ */
    function applyVisibility() {
        colPills.querySelectorAll(".col-pill").forEach(pill => {
            pill.classList.toggle("active", visibleCols.has(pill.dataset.col));
        });
        tableHead.querySelectorAll("th[data-col]").forEach(th => {
            th.style.display = visibleCols.has(th.dataset.col) ? "" : "none";
        });
        tableBody.querySelectorAll("td[data-col]").forEach(td => {
            td.style.display = visibleCols.has(td.dataset.col) ? "" : "none";
        });
    }

    /* ════════════════════════════════════════════════════════
       RENDER HEAD
    ════════════════════════════════════════════════════════ */
    function renderHead() {
        tableHead.innerHTML = "<tr>" +
            allColumns.map(col =>
                `<th data-col="${esc(col)}" style="${visibleCols.has(col) ? "" : "display:none"}">${formatCol(col)}</th>`
            ).join("") + "</tr>";
    }

    /* ════════════════════════════════════════════════════════
       RENDER BODY
    ════════════════════════════════════════════════════════ */
    function renderBody() {
        if (filteredRows.length === 0) {
            mainTable.style.display = "none";
            emptyState.classList.add("visible");
            return;
        }
        mainTable.style.display = "";
        emptyState.classList.remove("visible");

        tableBody.innerHTML = filteredRows.map(row => {
            const origIdx = originalRows.indexOf(row);
            const dup = dupMeta[origIdx] || {};
            const rowCls = dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : "";

            const cells = allColumns.map(col => {
                const hidden = !visibleCols.has(col);
                const isName = col === "your-name";
                const isEmailCol = col === "your-email";
                const isPhoneCol = col === "your-number";
                const isTimeCol = col === "submit_time";

                let cellDupCls = "", dupTag = "", ISTtime = "";
                if (isEmailCol && dup.email) { cellDupCls = "dup-cell-email"; dupTag = `<span class="dup-tag email">dup</span>`; }
                if (isPhoneCol && dup.phone) { cellDupCls = "dup-cell-phone"; dupTag = `<span class="dup-tag phone">dup</span>`; }
                if (isTimeCol && dup.time) { cellDupCls = "dup-cell-time"; dupTag = `<span class="dup-tag time">same</span>`; }

                const cls = [tdClass(col), cellDupCls, isName ? "lead-name-link" : ""].filter(Boolean).join(" ");
                const rowAttr = isName ? ` data-row="${origIdx}"` : "";
                return `<td data-col="${esc(col)}"${rowAttr} class="${cls}" title="${esc(row[col])}" style="${hidden ? "display:none" : ""}">${formatValue(col, row[col])}${dupTag}</td>`;
            }).join("");

            return `<tr class="${rowCls}">${cells}</tr>`;
        }).join("");
    }
    /* ════════════════════════════════════════════════════════
       LEAD DETAIL MODAL
       Click a lead's name → show ALL fields for that lead.
    ════════════════════════════════════════════════════════ */
    const leadModal = document.getElementById("leadModal");
    const leadModalBody = document.getElementById("leadModalBody");
    const leadModalSub = document.getElementById("leadModalSub");

    tableBody.addEventListener("click", function (e) {
        const cell = e.target.closest('td[data-col="your-name"]');
        if (!cell) return;
        const idx = Number(cell.dataset.row);
        const row = originalRows[idx];
        if (row) openLeadModal(row);
    });

    document.getElementById("leadModalClose").addEventListener("click", closeLeadModal);
    leadModal.addEventListener("click", e => { if (e.target === leadModal) closeLeadModal(); });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && leadModal.classList.contains("visible")) closeLeadModal();
    });

    function openLeadModal(row) {
        const name = row["your-name"];
        const email = row["your-email"];
        leadModalSub.textContent = [name, email].filter(Boolean).join("  ·  ") || "-";

        leadModalBody.innerHTML = allColumns.map(col => `
            <div class="lead-field">
                <div class="lead-field-label">${formatCol(col)}</div>
                <div class="lead-field-value">${formatValue(col, row[col])}</div>
            </div>`).join("");

        leadModal.classList.add("visible");
    }

    function closeLeadModal() {
        leadModal.classList.remove("visible");
    }

    /* ════════════════════════════════════════════════════════
       EXPORT
    ════════════════════════════════════════════════════════ */
    function getVisibleCols() { return allColumns.filter(c => visibleCols.has(c)); }

    function rawValue(col, row) {
        const v = row[col];
        if (v === null || v === undefined || v === "") return "";
        if (col.startsWith("utm_")) return extractUtmVal(v, col);
        return Array.isArray(v) ? v.join(", ") : String(v);
    }

    function doExportCSV(rows, isDupOnly) {
        const cols = getVisibleCols();
        const label = isDupOnly ? "_duplicates" : "";
        if (!rows.length) { showToast("No rows to export", "error"); return; }

        const extraCols = isDupOnly ? ["_dup_email", "_dup_phone", "_dup_time"] : [];
        const header = [...cols, ...extraCols].map(csvEsc).join(",");
        const lines = rows.map(row => {
            const origIdx = originalRows.indexOf(row);
            const dup = dupMeta[origIdx] || {};
            const cells = cols.map(c => csvEsc(rawValue(c, row)));
            if (isDupOnly) {
                cells.push(dup.email ? "YES" : "");
                cells.push(dup.phone ? "YES" : "");
                cells.push(dup.time ? "YES" : "");
            }
            return cells.join(",");
        });

        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        downloadBlob([header, ...lines].join("\r\n"), `report${label}_${fromVal}_${toVal}.csv`, "text/csv;charset=utf-8;");
        showToast(`Exported ${rows.length} rows as CSV`, "success");
    }

    function doExportJSON(rows) {
        const cols = getVisibleCols();
        if (!rows.length) { showToast("No rows to export", "error"); return; }
        const data = rows.map(row => {
            const obj = {};
            cols.forEach(c => { obj[c] = rawValue(c, row) || null; });
            return obj;
        });
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        downloadBlob(JSON.stringify(data, null, 2), `report_${fromVal}_${toVal}.json`, "application/json");
        showToast(`Exported ${rows.length} rows as JSON`, "success");
    }

    function csvEsc(v) {
        const s = String(v ?? "");
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    function downloadBlob(content, filename, mime) {
        const blob = new Blob(["\uFEFF" + content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ════════════════════════════════════════════════════════
       HELPERS
    ════════════════════════════════════════════════════════ */
    function formatCol(col) {
        return col.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatValue(col, value) {

        if (value === null || value === undefined || value === "")
            return '<span style="color:var(--muted)">-</span>';
        if (col.startsWith("utm_")) {
            const resolved = extractUtmVal(value, col);
            return `<span class="badge">${esc(resolved || value)}</span>`;
        }
        if (Array.isArray(value)) return esc(value.join(", "));

        return esc(String(value));
    }

    function tdClass(col) {
        if (col.includes("email")) return "cell-email";
        if (col.includes("time") || col.includes("date")) return "cell-time";
        if (col.includes("url") || col.includes("submitted_from")) return "cell-url";
        return "";
    }

    function esc(v) {
        if (v == null) return "";
        return String(v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function updatePagination() {
        document.getElementById("paginationInfo").textContent =
            filteredRows.length === originalRows.length
                ? `Showing all ${originalRows.length} rows`
                : `Showing ${filteredRows.length} of ${originalRows.length} rows`;
    }

    function showLoader(on) {
        loaderWrap.classList.toggle("visible", on);
        mainTable.style.visibility = on ? "hidden" : "";
    }

    let toastTimer;
    function showToast(msg, type = "") {
        const t = document.getElementById("toast");
        t.className = "toast show " + type;
        document.getElementById("toastMsg").textContent = msg;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
    }

});