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
    let activeDupFilters = new Set();  // subset of 'email' | 'phone' | 'time' - OR combined
    let activeCampaignFilter = null;  // exact string | null
    let activeSourceFilter = null;  // exact string | null
    let activeDateFilter = null;  // exact string | null
    let activePageFilter = null;  // exact string | null
    let activeAdtypeFilter = null;  // 'Organic' | 'Ads' | null

    /* Accordion open state - persisted across re-renders */
    const breakdownOpen = { campaign: false, source: false, date: false, page: false, adtype: false };

    /* Period-over-period comparison state (previous equivalent date range) */
    let compareRows = null;            // rows from the previous period, or null if not yet loaded/unavailable
    let compareCampaignMap = null;     // { utm_campaign value -> count } for the previous period
    let compareSourceMap = null;       // { utm_source value -> count } for the previous period
    let compareRequestId = 0;          // guards against stale async responses
    let lastPrevRange = null;          // { from, to } of the last loaded comparison period

    /* Table sort state - persists across filter changes */
    let sortState = { col: null, dir: 1 };  // dir: 1 = asc, -1 = desc

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
    const filterChips = document.getElementById("filterChips");
    const presetBtns = document.querySelectorAll(".preset-btn");

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
    document.getElementById("btnCompact").addEventListener("click", e => {
        e.stopPropagation();
        const compactCols = ["your-name", "your-email", "your-number", "submit_time"].filter(c => allColumns.includes(c));
        visibleCols = new Set(compactCols.length ? compactCols : defaultShowCols);
        applyVisibility();
    });

    /* ══════════════════════════════════════
       THEME TOGGLE (light/dark, persisted)
    ══════════════════════════════════════ */
    const THEME_KEY = "reportTheme";
    document.getElementById("themeToggle").addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme");
        const isDark = current === "dark" || (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
        const next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });

    /* ══════════════════════════════════════
       MOBILE FILTERS TOGGLE
    ══════════════════════════════════════ */
    document.getElementById("mobileFiltersToggle").addEventListener("click", () => {
        document.getElementById("controlsBar").classList.toggle("mobile-open");
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
        setActivePreset(null);
        loadData();
    });
    document.getElementById("showAllBtn").addEventListener("click", () => {
        tableSearch.value = "";
        clearAllFilters();
        applyFilters();
    });
    tableSearch.addEventListener("input", applyFilters);

    /* ══════════════════════════════════════
       DATE RANGE PRESETS
    ══════════════════════════════════════ */
    presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const days = parseInt(btn.dataset.days, 10);
            const toD = new Date();
            const fromD = new Date();
            fromD.setDate(toD.getDate() - (days - 1));
            document.getElementById("from").value = fmt(fromD);
            document.getElementById("to").value = fmt(toD);
            setActivePreset(btn);
            loadData();
        });
    });
    /* Manually editing From/To no longer matches any preset */
    ["from", "to"].forEach(id =>
        document.getElementById(id).addEventListener("input", () => setActivePreset(null))
    );
    function setActivePreset(activeBtn) {
        presetBtns.forEach(b => b.classList.toggle("active", b === activeBtn));
    }

    /* ══════════════════════════════════════
       DUP FILTER CARDS
    ══════════════════════════════════════ */
    document.getElementById("cardDupEmail").addEventListener("click", () => toggleDupFilter("email"));
    document.getElementById("cardDupPhone").addEventListener("click", () => toggleDupFilter("phone"));
    document.getElementById("cardDupTime").addEventListener("click", () => toggleDupFilter("time"));
    document.getElementById("cardDupPk92").addEventListener("click", () => toggleDupFilter("pk92"));
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
        const dupRows = originalRows.filter((_, i) => dupMeta[i]?.email || dupMeta[i]?.phone || dupMeta[i]?.time || dupMeta[i]?.pk92);
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
                    db: 'landing',
                    from: document.getElementById("from").value,
                    to: document.getElementById("to").value,
                })
            });
            if (!res.ok) throw new Error(`Server error - HTTP ${res.status}`);
            const data = await res.json();
            if (data.status !== "success") throw new Error(data.error || "API returned an error");
            renderAll(data);
            loadComparison();
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

    /* ════════════════════════════════════════════════════════
       PERIOD-OVER-PERIOD COMPARISON
       Fetches the immediately preceding period of equal length
       (e.g. this week vs last week) and derives delta indicators
       for Total Rows / Showing plus per UTM Campaign/Source.
    ════════════════════════════════════════════════════════ */
    function getPreviousRange(fromStr, toStr) {
        const from = new Date(fromStr + "T00:00:00");
        const to = new Date(toStr + "T00:00:00");
        const rangeDays = Math.round((to - from) / 86400000) + 1;
        const prevTo = new Date(from);
        prevTo.setDate(prevTo.getDate() - 1);
        const prevFrom = new Date(prevTo);
        prevFrom.setDate(prevFrom.getDate() - (rangeDays - 1));
        return { from: fmt(prevFrom), to: fmt(prevTo) };
    }

    async function fetchRows(from, to) {
        const res = await fetch("./../api/get_report.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ db: "landing", from, to })
        });
        if (!res.ok) throw new Error(`Server error - HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== "success") throw new Error(data.error || "API returned an error");
        return data.rows || [];
    }

    async function loadComparison() {
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        if (!fromVal || !toVal) return;

        const myRequestId = ++compareRequestId;
        const prevRange = getPreviousRange(fromVal, toVal);
        setDeltaLoading();

        try {
            const rows = await fetchRows(prevRange.from, prevRange.to);
            if (myRequestId !== compareRequestId) return; // a newer request superseded this one
            compareRows = rows;
        } catch (err) {
            console.error("Comparison fetch failed", err);
            if (myRequestId !== compareRequestId) return;
            compareRows = null;
        }
        renderComparison(prevRange);
    }

    function buildFreqValueMap(rows, dimension) {
        const map = {};
        rows.forEach(row => {
            const val = extractUtmVal(row[dimension], dimension).trim() || "(none)";
            map[val] = (map[val] || 0) + 1;
        });
        return map;
    }

    function renderComparison(prevRange) {
        const totalDeltaEl = document.getElementById("statTotalDelta");
        const showingDeltaEl = document.getElementById("statShowingDelta");

        if (compareRows == null) {
            compareCampaignMap = null;
            compareSourceMap = null;
            totalDeltaEl.textContent = "";
            totalDeltaEl.className = "stat-delta";
            showingDeltaEl.textContent = "";
            showingDeltaEl.className = "stat-delta";
            return;
        }

        lastPrevRange = prevRange;
        setDeltaText(totalDeltaEl, originalRows.length, compareRows.length, prevRange);
        updateShowingDelta();

        compareCampaignMap = buildFreqValueMap(compareRows, "utm_campaign");
        compareSourceMap = buildFreqValueMap(compareRows, "utm_source");
        refreshBreakdownCard("bc-campaign", "utm_campaign", "campaign", activeCampaignFilter);
        refreshBreakdownCard("bc-source", "utm_source", "source", activeSourceFilter);
    }

    /* Re-derived on every filter change (not just on load) so it never goes
       stale relative to the currently applied filters. */
    function updateShowingDelta() {
        const showingDeltaEl = document.getElementById("statShowingDelta");
        if (compareRows == null || !lastPrevRange) return;
        if (anyFilterActive()) {
            showingDeltaEl.textContent = "clear filters to compare";
            showingDeltaEl.className = "stat-delta flat";
        } else {
            setDeltaText(showingDeltaEl, filteredRows.length, compareRows.length, lastPrevRange);
        }
    }

    function setDeltaText(el, cur, prev, prevRange) {
        if (prev === 0 && cur === 0) {
            el.textContent = `No change · prev 0 (${prevRange.from} → ${prevRange.to})`;
            el.className = "stat-delta flat";
            return;
        }
        if (prev === 0) {
            el.textContent = `▲ New · prev 0 (${prevRange.from} → ${prevRange.to})`;
            el.className = "stat-delta up";
            return;
        }
        const pct = Math.round(((cur - prev) / prev) * 100);
        const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "▬";
        const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
        el.className = "stat-delta " + cls;
        el.textContent = `${arrow} ${pct > 0 ? "+" : ""}${pct}% vs prev ${prevRange.from} → ${prevRange.to} (${prev})`;
    }

    function setDeltaLoading() {
        ["statTotalDelta", "statShowingDelta"].forEach(id => {
            const el = document.getElementById(id);
            el.textContent = "comparing…";
            el.className = "stat-delta flat";
        });
    }

    /* Small "vs previous period" badge for UTM Campaign/Source breakdown rows.
       Only meaningful when comparing like-for-like, so it's hidden while any
       other filter narrows the current set (search/dup/other breakdowns). */
    function buildDeltaBadge(filterKey, value, count) {
        let prevMap = null;
        if (filterKey === "campaign") prevMap = compareCampaignMap;
        else if (filterKey === "source") prevMap = compareSourceMap;
        if (!prevMap || anyFilterActive()) return "";

        const prev = prevMap[value] || 0;
        if (prev === 0) return `<span class="bi-delta up" title="No submissions in the previous period">new</span>`;

        const pct = Math.round(((count - prev) / prev) * 100);
        const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
        const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "▬";
        return `<span class="bi-delta ${cls}" title="Previous period: ${prev}">${arrow}${pct > 0 ? "+" : ""}${pct}%</span>`;
    }

    function anyFilterActive() {
        return activeDupFilters.size > 0 || !!activeCampaignFilter || !!activeSourceFilter ||
            !!activeDateFilter || !!activePageFilter || !!activeAdtypeFilter || !!tableSearch.value.trim();
    }

    /* DUPLICATE ANALYSIS */
    function analyseDuplicates(rows) {
        const meta = {};
        rows.forEach((_, i) => (meta[i] = { email: false, phone: false, time: false, pk92: false }));
        const emailMap = buildFreqMap(rows, r => norm(r["your-email"]));
        const timeMap = buildFreqMap(rows, r => norm(r["submit_time"]));
        /* +92 (Pakistan) numbers are their own group - excluded entirely from
           Dup. Phone detection so they never inflate or trigger that count */
        const phoneMap = buildFreqMap(rows, r => isPk92Number(r["your-number"]) ? null : norm(r["your-number"]));
        rows.forEach((row, i) => {
            const e = norm(row["your-email"]);
            const p = norm(row["your-number"]);
            const t = norm(row["submit_time"]);
            const isPk92 = isPk92Number(row["your-number"]);
            if (e && emailMap[e] > 1) meta[i].email = true;
            if (!isPk92 && p && phoneMap[p] > 1) meta[i].phone = true;
            if (t && timeMap[t] > 1) meta[i].time = true;
            meta[i].pk92 = isPk92;
        });
        return meta;
    }
    function buildFreqMap(rows, fn) {
        const m = {};
        rows.forEach(r => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; });
        return m;
    }
    function norm(v) { return (v == null || v === "") ? null : String(v).trim().toLowerCase(); }

    /* +92 / 0092 (Pakistan) country code, after stripping spaces/dashes/parens */
    function isPk92Number(v) {
        if (v == null || v === "") return false;
        const cleaned = String(v).trim().replace(/[\s\-().]/g, "");
        return /^(\+92|0092)/.test(cleaned);
    }

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
        filteredRows = sortRows([...originalRows]);
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
        document.getElementById("tableHdrMeta").textContent = `${fromVal} to ${toVal}`;

        const dupEmailCount = originalRows.filter((_, i) => dupMeta[i]?.email).length;
        const dupPhoneCount = originalRows.filter((_, i) => dupMeta[i]?.phone).length;
        const dupTimeCount = originalRows.filter((_, i) => dupMeta[i]?.time).length;
        const pk92Count = originalRows.filter((_, i) => dupMeta[i]?.pk92).length;
        document.getElementById("statDupEmail").textContent = dupEmailCount;
        document.getElementById("statDupPhone").textContent = dupPhoneCount;
        document.getElementById("statDupTime").textContent = dupTimeCount;
        document.getElementById("statDupPk92").textContent = pk92Count;

        updateShowingDelta();

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
            const isNone = value === "(none)" || value === "(unknown)";
            const isAct = value === activeVal;
            const deltaHtml = buildDeltaBadge(filterKey, value, count);

            return `<div class="breakdown-item${isAct ? " active" : ""}"
                         data-filter-key="${filterKey}"
                         data-value="${esc(value)}">
                        <span class="bi-label">${isNone ? `<em>${value}</em>` : esc(value)}</span> 
                        ${deltaHtml}
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
    const dupLabels = { email: "Dup Email", phone: "Dup Phone", time: "Same Time", pk92: "+92 Number" };

    function updateFilterStrip() {
        /* Each chip carries its own removal handler so filters can be
           cleared individually without disturbing the others or the date range. */
        const chips = [];
        activeDupFilters.forEach(t => chips.push({ label: dupLabels[t], onRemove: () => toggleDupFilter(t) }));
        if (activeCampaignFilter) chips.push({ label: `Campaign: ${activeCampaignFilter}`, onRemove: () => { activeCampaignFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeSourceFilter) chips.push({ label: `Source: ${activeSourceFilter}`, onRemove: () => { activeSourceFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeDateFilter) chips.push({ label: `Date: ${activeDateFilter}`, onRemove: () => { activeDateFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activePageFilter) chips.push({ label: `Page: ${activePageFilter}`, onRemove: () => { activePageFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeAdtypeFilter) chips.push({ label: `Type: ${activeAdtypeFilter}`, onRemove: () => { activeAdtypeFilter = null; updateFilterStrip(); applyFilters(); } });

        if (chips.length === 0) {
            filterStrip.classList.remove("visible");
            filterChips.innerHTML = "";
            return;
        }

        filterStrip.classList.add("visible");
        filterChips.innerHTML = chips.map((c, i) =>
            `<span class="filter-chip" data-idx="${i}">${esc(c.label)}<button type="button" aria-label="Remove filter">✕</button></span>`
        ).join("");
        filterChips.querySelectorAll(".filter-chip").forEach((el, i) => {
            el.querySelector("button").addEventListener("click", () => chips[i].onRemove());
        });
    }

    /* ════════════════════════════════════════════════════════
       DUP FILTER TOGGLE
       Email / Phone / Same-Time can all be active together -
       a row matching ANY active condition is shown (OR logic).
    ════════════════════════════════════════════════════════ */
    function toggleDupFilter(type) {
        if (activeDupFilters.has(type)) activeDupFilters.delete(type);
        else activeDupFilters.add(type);
        ["email", "phone", "time", "pk92"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.toggle("active-filter", activeDupFilters.has(t))
        );
        updateFilterStrip();
        applyFilters();
    }

    function clearAllFilters() {
        activeDupFilters.clear();
        activeCampaignFilter = null;
        activeSourceFilter = null;
        activeDateFilter = null;
        activePageFilter = null;
        activeAdtypeFilter = null;
        ["email", "phone", "time", "pk92"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.remove("active-filter")
        );
        updateFilterStrip();
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ════════════════════════════════════════════════════════
       APPLY ALL FILTERS
       Order: text search → dup → source → campaign → date → page → adtype
       Dup filters (email/phone/time) are OR-combined among themselves;
       everything else AND-combines with that result (each narrows the set).
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

        /* 2. Duplicate flags - OR combined: a row matching ANY active
              dup condition (email / phone / same-time) is kept */
        if (activeDupFilters.size > 0) {
            rows = rows.filter(row => {
                const idx = originalRows.indexOf(row);
                const meta = dupMeta[idx];
                if (!meta) return false;
                for (const t of activeDupFilters) if (meta[t]) return true;
                return false;
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

        filteredRows = sortRows(rows);
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
       RENDER HEAD  (all columns sortable - click cycles asc/desc)
    ════════════════════════════════════════════════════════ */
    function renderHead() {
        tableHead.innerHTML = "<tr>" +
            allColumns.map(col => {
                const isSortCol = sortState.col === col;
                const dirCls = isSortCol ? (sortState.dir === 1 ? " sort-asc" : " sort-desc") : "";
                const ind = isSortCol ? (sortState.dir === 1 ? "▲" : "▼") : "⇅";
                return `<th data-col="${esc(col)}" class="sortable${dirCls}" style="${visibleCols.has(col) ? "" : "display:none"}">${formatCol(col)}<span class="sort-ind">${ind}</span></th>`;
            }).join("") + "</tr>";

        tableHead.querySelectorAll("th[data-col]").forEach(th => {
            th.addEventListener("click", () => onSortClick(th.dataset.col));
        });
    }

    function onSortClick(col) {
        if (sortState.col === col) sortState.dir = -sortState.dir;
        else { sortState.col = col; sortState.dir = 1; }
        filteredRows = sortRows(filteredRows);
        renderHead();
        renderBody();
    }

    /* Generic sort: numeric compare when both sides parse as numbers,
       otherwise a case-insensitive string compare (works fine for the
       ISO-like submit_time format too). */
    function sortRows(rows) {
        if (!sortState.col) return rows;
        const col = sortState.col, dir = sortState.dir;
        return [...rows].sort((a, b) => {
            const av = a[col] == null ? "" : a[col];
            const bv = b[col] == null ? "" : b[col];
            const an = Number(av), bn = Number(bv);
            const bothNumeric = av !== "" && bv !== "" && !isNaN(an) && !isNaN(bn);
            const cmp = bothNumeric ? (an - bn) : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
            return cmp * dir;
        });
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
            const rowCls = dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : dup.pk92 ? "dup-pk92" : "";

            const cells = allColumns.map(col => {
                const hidden = !visibleCols.has(col);
                const isName = col === "your-name";
                const isEmailCol = col === "your-email";
                const isPhoneCol = col === "your-number";
                const isTimeCol = col === "submit_time";

                let cellDupCls = "", dupTag = "", ISTtime = "";
                if (isEmailCol && dup.email) { cellDupCls = "dup-cell-email"; dupTag = `<span class="dup-tag email">dup</span>`; }
                if (isPhoneCol && dup.phone) { cellDupCls = "dup-cell-phone"; dupTag = `<span class="dup-tag phone">dup</span>`; }
                else if (isPhoneCol && dup.pk92) { cellDupCls = "dup-cell-pk92"; dupTag = `<span class="dup-tag pk92">+92</span>`; }
                if (isTimeCol && dup.time) { cellDupCls = "dup-cell-time"; dupTag = `<span class="dup-tag time">same</span>`; }

                const cls = [tdClass(col), cellDupCls, isName ? "lead-name-link" : ""].filter(Boolean).join(" ");
                const rowAttr = isName ? ` data-row="${origIdx}"` : "";
                return `<td data-col="${esc(col)}"${rowAttr} class="${cls}" title="${esc(row[col])}" style="${hidden ? "display:none" : ""}">${formatValue(col, row[col])}${dupTag}</td>`;
            }).join("");

            return `<tr class="${rowCls}">${cells}</tr>`;
        }).join("");

        renderMobileCards();
    }

    /* ════════════════════════════════════════════════════════
       MOBILE CARD-PER-ROW VIEW (<768px)
       Same filteredRows/dupMeta as the table - CSS decides which
       of the two is visible at the current viewport width.
    ════════════════════════════════════════════════════════ */
    const mobileCardFields = ["your-email", "your-number", "utm_source", "utm_medium", "utm_campaign", "your-city", "your-country", "submit_time"];

    function renderMobileCards() {
        const mobileCards = document.getElementById("mobileCards");
        if (filteredRows.length === 0) { mobileCards.innerHTML = ""; return; }

        mobileCards.innerHTML = filteredRows.map(row => {
            const origIdx = originalRows.indexOf(row);
            const dup = dupMeta[origIdx] || {};
            const rowCls = dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : dup.pk92 ? "dup-pk92" : "";
            const tags = [
                dup.email ? `<span class="dup-tag email">dup</span>` : "",
                dup.phone ? `<span class="dup-tag phone">dup</span>` : "",
                dup.pk92 ? `<span class="dup-tag pk92">+92</span>` : "",
                dup.time ? `<span class="dup-tag time">same</span>` : "",
            ].join("");
            const rowsHtml = mobileCardFields.filter(c => allColumns.includes(c)).map(c =>
                `<div class="m-card-row"><span class="k">${formatCol(c)}</span><span class="v">${formatValue(c, row[c])}</span></div>`
            ).join("");

            return `<div class="m-card ${rowCls}">
                <div class="m-card-hdr">
                    <span class="m-card-name" data-row="${origIdx}">${esc(row["your-name"] || "(no name)")}</span>
                    <div class="m-card-tags">${tags}</div>
                </div>
                ${rowsHtml}
            </div>`;
        }).join("");
    }

    document.getElementById("mobileCards").addEventListener("click", e => {
        const el = e.target.closest(".m-card-name");
        if (!el) return;
        const idx = Number(el.dataset.row);
        const row = originalRows[idx];
        if (row) openLeadModal(row);
    });

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

        const extraCols = isDupOnly ? ["_dup_email", "_dup_phone", "_dup_time", "_pk92"] : [];
        const header = [...cols, ...extraCols].map(csvEsc).join(",");
        const lines = rows.map(row => {
            const origIdx = originalRows.indexOf(row);
            const dup = dupMeta[origIdx] || {};
            const cells = cols.map(c => csvEsc(rawValue(c, row)));
            if (isDupOnly) {
                cells.push(dup.email ? "YES" : "");
                cells.push(dup.phone ? "YES" : "");
                cells.push(dup.time ? "YES" : "");
                cells.push(dup.pk92 ? "YES" : "");
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