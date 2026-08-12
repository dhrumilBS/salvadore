document.addEventListener("DOMContentLoaded", () => {

    /* ══════════════════════════════════════
       STATE
    ══════════════════════════════════════ */
    let originalRows = [];     // current-period rows, +92 test data already excluded
    let pk92Rows = [];         // current-period +92 (Pakistan/test) rows - own group, excluded from all analytics
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
    let activeIntlFilter = false;  // true = show only non +91 (outside India) numbers

    /* Accordion open state - persisted across re-renders */
    const breakdownOpen = { campaign: false, source: false, date: false, page: false, adtype: false };

    /* Period-over-period comparison state (previous equivalent date range).
       compareRows / compareDupMeta / compareFilteredRows always mirror
       originalRows / dupMeta / filteredRows so every metric is compared
       like-for-like under the SAME active filters. */
    let compareRows = null;            // previous-period rows (+92 excluded), or null if not yet loaded/unavailable
    let compareDupMeta = {};
    let compareFilteredRows = null;    // previous-period rows run through the current filter state
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
    const presetToggle = document.querySelector(".presets-dropdown .dropdown-toggle");

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
        if (presetToggle) {
            presetToggle.textContent = activeBtn ? activeBtn.textContent + " ▾" : "View ▾";
        }
    }

    /* ══════════════════════════════════════
       DUP FILTER CARDS
    ══════════════════════════════════════ */
    document.getElementById("cardDupEmail").addEventListener("click", () => toggleDupFilter("email"));
    document.getElementById("cardDupPhone").addEventListener("click", () => toggleDupFilter("phone"));
    document.getElementById("cardDupTime").addEventListener("click", () => toggleDupFilter("time"));
    document.getElementById("cardOutsideIndia").addEventListener("click", toggleIntlFilter);
    document.getElementById("clearDupFilter").addEventListener("click", () => { clearAllFilters(); applyFilters(); });

    /* +92 (Pakistan/test) data lives in its own panel, entirely separate from
       the dup OR-filter set - it's a data-quality segregation, not a lead filter. */
    document.getElementById("cardDupPk92").addEventListener("click", () => {
        document.getElementById("pk92Panel").classList.toggle("open");
    });
    document.getElementById("pk92PanelClose").addEventListener("click", () => {
        document.getElementById("pk92Panel").classList.remove("open");
    });

    /* ══════════════════════════════════════
       COMPARISON DELTA - click to expand full details
       (primary metric stays a plain percentage; date range +
       previous-period count live in this secondary panel)
    ══════════════════════════════════════ */
    document.getElementById("statTotalDelta").addEventListener("click", () => {
        document.getElementById("statTotalDeltaDetail").classList.toggle("open");
    });
    document.getElementById("statShowingDelta").addEventListener("click", () => {
        document.getElementById("statShowingDeltaDetail").classList.toggle("open");
    });

    /* ══════════════════════════════════════
       DROPDOWN COMPONENT
    ══════════════════════════════════════ */
    initDropdowns();

    function initDropdowns() {
        const dropdowns = document.querySelectorAll(".dropdown");
        dropdowns.forEach(dropdown => {
            const toggle = dropdown.querySelector(".dropdown-toggle");
            const menu = dropdown.querySelector(".dropdown-menu");
            if (!toggle || !menu) return;

            toggle.addEventListener("click", e => {
                e.stopPropagation();
                closeAllDropdowns();
                menu.classList.toggle("open");
            });

            menu.addEventListener("click", e => e.stopPropagation());
        });

        document.addEventListener("click", closeAllDropdowns);
    }

    function closeAllDropdowns() {
        document.querySelectorAll(".dropdown-menu.open").forEach(menu => menu.classList.remove("open"));
    }

    document.getElementById("exportCSV").addEventListener("click", () => {
        closeAllDropdowns(); doExportCSV(filteredRows, false);
    });
    document.getElementById("exportJSON").addEventListener("click", () => {
        closeAllDropdowns(); doExportJSON(filteredRows);
    });
    document.getElementById("exportDupCSV").addEventListener("click", () => {
        closeAllDropdowns();
        const dupRows = originalRows.filter((_, i) => dupMeta[i]?.email || dupMeta[i]?.phone || dupMeta[i]?.time);
        if (!dupRows.length) { showToast("No duplicate rows found", "error"); return; }
        doExportCSV(dupRows, true);
    });
    document.getElementById("exportPk92CSV").addEventListener("click", () => {
        closeAllDropdowns();
        if (!pk92Rows.length) { showToast("No Pakistan/Test rows found", "error"); return; }
        doExportPk92CSV();
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
       (e.g. this week vs last week). Every active filter (search,
       dup flags, source, campaign, date, page, adtype) is re-applied
       to the previous period identically, so every metric - totals,
       dup counts, breakdown items - compares like-for-like.
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
            const rawRows = await fetchRows(prevRange.from, prevRange.to);
            if (myRequestId !== compareRequestId) return; // a newer request superseded this one
            /* +92 test data is excluded from the previous period too, same as the current one */
            compareRows = rawRows.filter(r => !isPk92Number(r["your-number"]));
            compareDupMeta = analyseDuplicates(compareRows);
        } catch (err) {
            console.error("Comparison fetch failed", err);
            if (myRequestId !== compareRequestId) return;
            compareRows = null;
            compareDupMeta = {};
        }
        lastPrevRange = prevRange;
        compareFilteredRows = compareRows ? computeFilteredRows(compareRows, compareDupMeta, getActiveFilterState()) : null;
        refreshStats();
    }

    function setDeltaLoading() {
        [["statTotalDelta", "statTotalDeltaDetail"], ["statShowingDelta", "statShowingDeltaDetail"]].forEach(([dId, detId]) => {
            const el = document.getElementById(dId);
            const det = document.getElementById(detId);
            el.textContent = "…";
            el.className = "stat-delta flat";
            el.removeAttribute("title");
            if (det) { det.innerHTML = ""; det.classList.remove("open"); }
        });
    }

    /* Primary metric is percentage-only (e.g. "▼ -63%"); full detail
       (date range + previous count) goes in the tooltip and, for the
       two headline KPIs, an expandable detail panel below the metric. */
    function setDeltaText(el, cur, prev, prevRange, detailEl) {
        if (!el) return;
        if (prev == null || !prevRange) {
            el.textContent = "";
            el.className = "stat-delta";
            el.removeAttribute("title");
            if (detailEl) { detailEl.innerHTML = ""; detailEl.classList.remove("open"); }
            return;
        }
        let arrow, cls, pctLabel;
        if (prev === 0 && cur === 0) {
            arrow = "▶"; cls = "flat"; pctLabel = "0%";
        } else if (prev === 0) {
            arrow = "▲"; cls = "up"; pctLabel = "New";
        } else {
            const pct = Math.round(((cur - prev) / prev) * 100);
            arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "▶";
            cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
            pctLabel = `${pct > 0 ? "+" : ""}${pct}%`;
        }
        el.textContent = `${arrow} ${pctLabel}`;
        el.className = "stat-delta " + cls;
        el.title = `Compared with ${prevRange.from} → ${prevRange.to} · Previous period: ${prev} leads`;
        if (detailEl) {
            detailEl.innerHTML =
                `Compared with<br><strong>${esc(prevRange.from)} → ${esc(prevRange.to)}</strong><br>` +
                `Previous Period: <strong>${prev} Leads</strong>`;
        }
    }

    /* Small "vs previous period" badge for breakdown rows - prevMap is
       already built from compareFilteredRows, so it's scoped by every
       other active filter exactly like the current-side count is. */
    function buildDeltaBadge(prevMap, value, count) {
        if (!prevMap) return "";
        const prev = prevMap[value] || 0;
        if (prev === 0 && count === 0) return "";
        if (prev === 0) return `<span class="bi-delta up" title="No submissions in the previous period">new</span>`;
        const pct = Math.round(((count - prev) / prev) * 100);
        const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
        const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "▶";
        return `<span class="bi-delta ${cls}" title="Previous period: ${prev}">${arrow}${pct > 0 ? "+" : ""}${pct}%</span>`;
    }

    /* ════════════════════════════════════════════════════════
       +92 / PAKISTAN-TEST DETECTION
       Numbers beginning with +92 / 0092 are data-entry/testing
       records - detected once, then fully removed from originalRows
       (and everything derived from it: dedup, breakdowns, comparison,
       KPIs) and rendered separately in their own panel.
    ════════════════════════════════════════════════════════ */
    function isPk92Number(v) {
        if (v == null || v === "") return false;
        const cleaned = String(v).trim().replace(/[\s\-().]/g, "");
        return /^(\+92|0092)/.test(cleaned);
    }

    /* "Outside India" filter - numbers NOT beginning with +91 / 0091.
       Unlike +92, these rows are NOT excluded from analytics - this is just
       a lens on the existing dataset, same as the Source/Campaign filters. */
    function isNonIndiaNumber(v) {
        if (v == null || v === "") return false;
        const cleaned = String(v).trim().replace(/[\s\-().]/g, "");
        return !/^(\+91|0091)/.test(cleaned);
    }

    /* DUPLICATE ANALYSIS - rows passed in never include +92 rows,
       so no exclusion logic is needed here. */
    function analyseDuplicates(rows) {
        const meta = {};
        rows.forEach((_, i) => (meta[i] = { email: false, phone: false, time: false }));
        const emailMap = buildFreqMap(rows, r => norm(r["your-email"]));
        const timeMap = buildFreqMap(rows, r => norm(r["submit_time"]));
        const phoneMap = buildFreqMap(rows, r => norm(r["your-number"]));
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
        const allRows = data.rows || [];

        /* Split off +92 (Pakistan/test) rows FIRST - everything downstream
           (dedup, breakdowns, KPIs, comparisons) only ever sees originalRows. */
        pk92Rows = allRows.filter(r => isPk92Number(r["your-number"]));
        originalRows = allRows.filter(r => !isPk92Number(r["your-number"]));

        defaultShowCols = data.defaultShow || allColumns;
        dupMeta = analyseDuplicates(originalRows);

        if (visibleCols.size === 0) visibleCols = new Set(defaultShowCols);

        buildPills();
        renderHead();
        filteredRows = sortRows([...originalRows]);
        renderBody();
        renderPk92Panel();
        refreshStats();          // stat cards + breakdown cards
        updatePagination();
    }

    /* ════════════════════════════════════════════════════════
       +92 / PAKISTAN-TEST PANEL
       Its own section, entirely outside the filtered dataset -
       never counted in totals, dup counts, breakdowns or comparisons.
    ════════════════════════════════════════════════════════ */
    function renderPk92Panel() {
        document.getElementById("statDupPk92").textContent = pk92Rows.length;
        document.getElementById("pk92PanelCount").textContent =
            `${pk92Rows.length} record${pk92Rows.length === 1 ? "" : "s"}`;

        const body = document.getElementById("pk92PanelBody");
        if (pk92Rows.length === 0) {
            body.innerHTML = `<div class="pk92-empty">No Pakistan / test records in this date range.</div>`;
            return;
        }

        body.innerHTML = `<table class="pk92-table"><thead><tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>Submit Time</th><th>Page</th>
            </tr></thead><tbody>` +
            pk92Rows.map(row => `<tr>
                <td>${esc(row["your-name"] || "-")}</td>
                <td>${esc(row["your-email"] || "-")}</td>
                <td>${esc(row["your-number"] || "-")}</td>
                <td>${esc(row["your-city"] || "-")}</td>
                <td>${esc(row["submit_time"] || "-")}</td>
                <td>${esc(getPageName(row))}</td>
            </tr>`).join("") +
            `</tbody></table>`;
    }

    /* ════════════════════════════════════════════════════════
       ACTIVE FILTER STATE + UNIFIED FILTERING
       One function, shared by the current period AND the
       comparison period, so both are always filtered identically.
    ════════════════════════════════════════════════════════ */
    function getActiveFilterState() {
        return {
            keyword: tableSearch.value.toLowerCase().trim(),
            dupFilters: activeDupFilters,
            source: activeSourceFilter,
            campaign: activeCampaignFilter,
            date: activeDateFilter,
            page: activePageFilter,
            adtype: activeAdtypeFilter,
            intl: activeIntlFilter,
        };
    }

    /* Applies every filter in `state` to `rows`, using `meta` (a dupMeta-shaped
       map keyed by index into `rows`) for the dup conditions. Works for either
       (originalRows, dupMeta) or (compareRows, compareDupMeta). */
    function computeFilteredRows(rows, meta, state) {
        let out = [...rows];

        if (state.keyword) {
            out = out.filter(row =>
                Object.values(row).some(v => String(v ?? "").toLowerCase().includes(state.keyword))
            );
        }

        if (state.dupFilters && state.dupFilters.size > 0) {
            out = out.filter(row => {
                const idx = rows.indexOf(row);
                const m = meta[idx];
                if (!m) return false;
                for (const t of state.dupFilters) if (m[t]) return true;
                return false;
            });
        }

        if (state.source) {
            out = out.filter(row => (extractUtmVal(row["utm_source"], "utm_source").trim() || "(none)") === state.source);
        }
        if (state.campaign) {
            out = out.filter(row => (extractUtmVal(row["utm_campaign"], "utm_campaign").trim() || "(none)") === state.campaign);
        }
        if (state.date) {
            out = out.filter(row => getRowDate(row) === state.date);
        }
        if (state.page) {
            out = out.filter(row => getPageName(row) === state.page);
        }
        if (state.adtype) {
            out = out.filter(row => getAdType(row) === state.adtype);
        }
        if (state.intl) {
            out = out.filter(row => isNonIndiaNumber(row["your-number"]));
        }
        return out;
    }

    /* ════════════════════════════════════════════════════════
       REFRESH STATS
       Called after EVERY filter change and after every comparison
       load so every KPI, dup count, and breakdown card - current
       AND previous period - always reflects the same active filters.
    ════════════════════════════════════════════════════════ */
    function refreshStats() {
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        document.getElementById("tableHdrMeta").textContent = `${fromVal} to ${toVal}`;

        const state = getActiveFilterState();

        document.getElementById("statTotal").textContent = originalRows.length;
        document.getElementById("statShowing").textContent = filteredRows.length;

        /* Dup counts scoped by every OTHER active filter (source/campaign/date/
           page/adtype/search) but not by the dup toggles themselves - e.g.
           Source=Ads narrows "Dup. Email" down to Ads-only duplicates. */
        const nonDupState = { ...state, dupFilters: new Set() };
        const scopedRows = computeFilteredRows(originalRows, dupMeta, nonDupState);
        const dupEmailCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.email).length;
        const dupPhoneCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.phone).length;
        const dupTimeCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.time).length;
        document.getElementById("statDupEmail").textContent = dupEmailCount;
        document.getElementById("statDupPhone").textContent = dupPhoneCount;
        document.getElementById("statDupTime").textContent = dupTimeCount;

        /* Outside India count scoped by every OTHER active filter, same pattern
           as the dup counts above - so e.g. Source=Ads narrows it to Ads-only. */
        const nonIntlState = { ...state, intl: false };
        const scopedForIntl = computeFilteredRows(originalRows, dupMeta, nonIntlState);
        const intlCount = scopedForIntl.filter(row => isNonIndiaNumber(row["your-number"])).length;
        document.getElementById("statOutsideIndia").textContent = intlCount;

        if (compareRows != null) {
            setDeltaText(
                document.getElementById("statTotalDelta"),
                originalRows.length, compareRows.length, lastPrevRange,
                document.getElementById("statTotalDeltaDetail")
            );
            setDeltaText(
                document.getElementById("statShowingDelta"),
                filteredRows.length, compareFilteredRows ? compareFilteredRows.length : 0, lastPrevRange,
                document.getElementById("statShowingDeltaDetail")
            );

            const scopedPrevRows = computeFilteredRows(compareRows, compareDupMeta, nonDupState);
            const prevDupEmailCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.email).length;
            const prevDupPhoneCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.phone).length;
            const prevDupTimeCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.time).length;
            setDeltaText(document.getElementById("statDupEmailDelta"), dupEmailCount, prevDupEmailCount, lastPrevRange);
            setDeltaText(document.getElementById("statDupPhoneDelta"), dupPhoneCount, prevDupPhoneCount, lastPrevRange);
            setDeltaText(document.getElementById("statDupTimeDelta"), dupTimeCount, prevDupTimeCount, lastPrevRange);

            const scopedPrevForIntl = computeFilteredRows(compareRows, compareDupMeta, nonIntlState);
            const prevIntlCount = scopedPrevForIntl.filter(row => isNonIndiaNumber(row["your-number"])).length;
            setDeltaText(document.getElementById("statOutsideIndiaDelta"), intlCount, prevIntlCount, lastPrevRange);
        } else {
            ["statTotalDelta", "statShowingDelta", "statDupEmailDelta", "statDupPhoneDelta", "statDupTimeDelta", "statOutsideIndiaDelta"].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.textContent = ""; el.className = "stat-delta"; el.removeAttribute("title"); }
            });
        }

        /* Breakdown cards - ALWAYS computed from filteredRows/compareFilteredRows
           so counts (current AND previous) update reactively with every filter. */
        refreshBreakdownCard("bc-campaign", "utm_campaign", "campaign", activeCampaignFilter);
        refreshBreakdownCard("bc-source", "utm_source", "source", activeSourceFilter);
        refreshBreakdownCard("bc-date", "date", "date", activeDateFilter);
        refreshBreakdownCard("bc-page", "page", "page", activePageFilter);
        refreshBreakdownCard("bc-adtype", "adtype", "adtype", activeAdtypeFilter);
    }

    /* ════════════════════════════════════════════════════════
       REFRESH BREAKDOWN CARD
       Re-renders list items from current filteredRows, with a
       vs-previous-period delta per item built from compareFilteredRows
       (already scoped by every other active filter).
    ════════════════════════════════════════════════════════ */
    function refreshBreakdownCard(cardId, dimension, filterKey, activeVal) {
        const card = document.getElementById(cardId);
        const list = card.querySelector(".breakdown-list");
        const total = card.querySelector(".breakdown-total");
        const uniq = card.querySelector(".breakdown-unique");

        const items = buildBreakdown(filteredRows, dimension);
        const sumCount = filteredRows.length;
        total.textContent = sumCount;
        uniq.textContent = `${items.length} unique`;

        let prevMap = null;
        if (compareFilteredRows) {
            prevMap = {};
            buildBreakdown(compareFilteredRows, dimension).forEach(({ value, count }) => { prevMap[value] = count; });
        }

        list.innerHTML = items.map(({ value, count }) => {
            const isNone = value === "(none)" || value === "(unknown)";
            const isAct = value === activeVal;
            const deltaHtml = buildDeltaBadge(prevMap, value, count);

            return `<div class="breakdown-item${isAct ? " active" : ""}"
                         data-filter-key="${filterKey}"
                         data-value="${esc(value)}">
                        <span class="bi-label">${isNone ? `<em>${value}</em>` : esc(value)}</span>
                        ${deltaHtml}
                        <span class="bi-count">${count}</span>
                    </div>`;
        }).join("");

        list.querySelectorAll(".breakdown-item").forEach(item => {
            item.addEventListener("click", () => onBreakdownItemClick(item, filterKey, list));
        });

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
       FILTER STRIP
    ════════════════════════════════════════════════════════ */
    const dupLabels = { email: "Dup Email", phone: "Dup Phone", time: "Same Time" };

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
        if (activeIntlFilter) chips.push({ label: "Outside India", onRemove: () => toggleIntlFilter() });

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
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.toggle("active-filter", activeDupFilters.has(t))
        );
        updateFilterStrip();
        applyFilters();
    }

    /* Outside-India toggle - a plain AND filter (like source/adtype), not
       part of the dup OR-set, since it's a country lens, not a duplicate flag. */
    function toggleIntlFilter() {
        activeIntlFilter = !activeIntlFilter;
        document.getElementById("cardOutsideIndia").classList.toggle("active-filter", activeIntlFilter);
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
        activeIntlFilter = false;
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.remove("active-filter")
        );
        document.getElementById("cardOutsideIndia").classList.remove("active-filter");
        updateFilterStrip();
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ════════════════════════════════════════════════════════
       APPLY ALL FILTERS
       Rebuilds filteredRows AND compareFilteredRows from the exact
       same filter state, so the comparison never drifts from
       whatever the user is currently looking at.
    ════════════════════════════════════════════════════════ */
    function applyFilters() {
        const state = getActiveFilterState();
        filteredRows = sortRows(computeFilteredRows(originalRows, dupMeta, state));
        compareFilteredRows = compareRows ? computeFilteredRows(compareRows, compareDupMeta, state) : null;

        renderBody();
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
            const rowCls = dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : "";

            const cells = allColumns.map(col => {
                const hidden = !visibleCols.has(col);
                const isName = col === "your-name";
                const isEmailCol = col === "your-email";
                const isPhoneCol = col === "your-number";
                const isTimeCol = col === "submit_time";

                let cellDupCls = "", dupTag = "";
                if (isEmailCol && dup.email) { cellDupCls = "dup-cell-email"; dupTag = `<span class="dup-tag email">dup</span>`; }
                if (isPhoneCol && dup.phone) { cellDupCls = "dup-cell-phone"; dupTag = `<span class="dup-tag phone">dup</span>`; }
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
            const rowCls = dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : "";
            const tags = [
                dup.email ? `<span class="dup-tag email">dup</span>` : "",
                dup.phone ? `<span class="dup-tag phone">dup</span>` : "",
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

    function doExportPk92CSV() {
        const cols = ["your-name", "your-email", "your-number", "your-city", "your-country", "submit_time"].filter(c => allColumns.includes(c));
        const header = cols.map(csvEsc).join(",");
        const lines = pk92Rows.map(row => cols.map(c => csvEsc(rawValue(c, row))).join(","));
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        downloadBlob([header, ...lines].join("\r\n"), `report_pk92_${fromVal}_${toVal}.csv`, "text/csv;charset=utf-8;");
        showToast(`Exported ${pk92Rows.length} Pakistan/Test rows as CSV`, "success");
    }

    function csvEsc(v) {
        const s = String(v ?? "");
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    function downloadBlob(content, filename, mime) {
        const blob = new Blob(["﻿" + content], { type: mime });
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
