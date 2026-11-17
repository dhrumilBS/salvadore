document.addEventListener("DOMContentLoaded", () => {

    /* ═══ STATE ═══ */
    let originalRows = [];     // current-period rows, +92 test data already excluded
    let pk92Rows = [];         // current-period +92 (Pakistan/test) rows - own group, excluded from all analytics
    let allColumns = [];
    let defaultShowCols = [];
    let filteredRows = [];
    let allRows = [];          // every API row in server order, +92 included - drives the table display only
    let displayRows = [];      // what the table/cards show: filteredRows + matching +92 rows (highlighted, never counted)
    let dupMeta = {};
    let visibleCols = new Set();
    const DUP_TYPES = ["email", "phone", "time"];   // the three duplicate checks, in display order

    /* Active filters - all stack together */
    let activeDupFilters = new Set();  // subset of 'email' | 'phone' | 'time' - OR combined
    let activeCampaignFilter = null;  // exact string | null
    let activeSourceFilter = null;  // exact string | null
    let activeDateFilter = null;  // exact string | null
    let activePageFilter = new Set();  // multi-select - a row matches ANY selected page
    let activeAdtypeFilter = null;  // 'Organic' | 'Ads' | null
    let activeLeadtypeFilter = null;  // 'Demo Request' | 'Email Signup' | null (Botphonic only)
    let activeIntlFilter = false;  // true = show only non +91 (outside India) numbers
    let activeBigBedFilter = false;  // true = show only 100+ bed leads (Healthray only)

    /* Accordion open state - persisted across re-renders */
    const breakdownOpen = { campaign: false, source: false, date: false, page: false, adtype: false, leadtype: false };

    /* Period-over-period comparison state (previous equivalent date range). compareRows / compareDupMeta / compareFilteredRows always mirror originalRows / dupMeta / filteredRows so every metric is compared like-for-like under the SAME active filters. */
    let compareRows = null;            // previous-period rows (+92 excluded), or null if not yet loaded/unavailable
    let compareDupMeta = {};
    let compareFilteredRows = null;    // previous-period rows run through the current filter state
    let compareRequestId = 0;          // guards against stale async responses
    let lastPrevRange = null;          // { from, to } of the last loaded comparison period

    /* Active data source ('landing' = Healthray, 'botphonic' = Botphonic). Kept in its own localStorage key - separate from any other tool's DB/site selection - so switching here never affects other pages. */
    const DB_KEY = "reportDb";
    const VALID_DBS = ["landing", "botphonic"];
    let activeDb = "landing";
    try {
        const stored = localStorage.getItem(DB_KEY);
        if (VALID_DBS.includes(stored)) activeDb = stored;
    } catch (e) { /* ignore */ }

    /* ═══ PER-SITE FIELD PROFILES ═══ Healthray and Botphonic run different Contact Form 7 setups, so the same concept (phone, landing page, paid vs organic) lives under different keys. Every site-specific field name lives here - the rest of the dashboard only asks the profile. */
    const SITE_PROFILES = {
        landing: {
            phoneCol: "your-number",
            bedCol: "bed_size",     // "101 – 300 beds" / "300+ or a group" get the 100+ Beds highlight
            pageKeys: ["page-name", "handl_url_cf7-264"],
            adsHint: "Ads = rows with a utm_campaign value · Organic = rows without one",
            isAds: row => hasUtmCampaign(row),
            normalize: null,
            dropCols: [],
            columnOrder: ["your-name", "bed_size", "your-number", "your-email", "your-city", "utm_campaign", "utm_source", "utm_medium", "submit_time"],
            defaultShow: ["your-name", "bed_size", "your-number", "your-email", "your-city", "utm_campaign", "utm_source", "utm_medium", "submit_time"],
            compactCols: ["your-name", "your-email", "your-number", "submit_time"],
            colLabels: { bed_size: "Bed Size / Hospitals / Software" },   // the same field also collects the hospitals / software answer
            mobileFields: ["your-email", "your-number", "bed_size", "utm_source", "utm_medium", "utm_campaign", "your-city", "your-country", "submit_time"],
            copyFields: ["Your Name", "Your Number", "Your Email", "Your City", "Your Business", "Bed Size / Hospitals / Software", "Speciality", "Page Name", "Utm Campaign", "Utm Source", "Utm Medium", "Submit Time", "User Ip"],
            pk92Cols: [["Name", "your-name"], ["Email", "your-email"], ["Phone", "your-number"], ["City", "your-city"], ["Submit Time", "submit_time"]],
            pk92ExportCols: ["your-name", "your-email", "your-number", "your-city", "your-country", "submit_time"],
            leadType: false,
        },
        botphonic: {
            /* "your-number" is typed without a country code ("86016 95454"); "full_phone" has it ("+918601695454") but is sometimes just "+91". normalize() picks the usable one into a "phone" column. */
            phoneCol: "phone",
            bedCol: null,           // no bed size on Botphonic forms
            pageKeys: ["full_url", "handl_ref", "handl_url_base_cf7"],
            adsHint: "Ads = Google click id (gclid), a paid utm_medium (cpc / Lead-search) or an *Ads utm_source · Organic = everything else, incl. utm_campaign \"seo\"",
            isAds: row => {
                if (row["gclid"] || row["gclid_cf7"]) return true;
                const medium = extractUtmVal(row["utm_medium"], "utm_medium").toLowerCase();
                const source = extractUtmVal(row["utm_source"], "utm_source").toLowerCase();
                return /cpc|ppc|paid|lead-search/.test(medium) || /ads$|adwords/.test(source);
            },
            normalize: row => {
                /* Botphonic logs submit_time in UTC (= created_date); Healthray's is already IST. Convert so times, Date Wise and Same Time match. */
                row["submit_time"] = utcToIst(row["submit_time"]);
                const full = String(row["full_phone"] || "").trim();
                row["phone"] = full.replace(/\D/g, "").length >= 8 ? full : (row["your-number"] || full || "");
                row["lead-type"] = (row["your-name"] || row["your-number"] || row["submit"]) ? "Demo Request" : "Email Signup";
                /* Full submitted-from URL (query string kept), like Healthray's "handl_url_cf7-264": contact form → full_url, footer email form → handl_url_base_cf7 */
                row["form-url"] = row["full_url"] || row["handl_url_base_cf7"] || row["handl_ref"] || "";
                const page = getPageName(row);
                row["page"] = page === "(unknown)" ? "" : page;
            },
            /* UTM "_cf7" keys are aliased to the plain names by the API, "submit" is folded into "lead-type" - showing them again is just noise. */
            dropCols: ["utm_campaign_cf7", "utm_source_cf7", "utm_medium_cf7", "gclid_cf7", "submit"],
            columnOrder: ["your-name", "your-email", "phone", "lead-type", "company-website", "use-case", "employees", "call-minutes", "your-message", "form-url", "page", "utm_source", "utm_medium", "utm_campaign", "submit_time"],
            defaultShow: ["your-name", "your-email", "phone", "lead-type", "use-case", "employees", "form-url", "utm_source", "utm_medium", "utm_campaign", "submit_time"],
            compactCols: ["your-name", "your-email", "phone", "lead-type", "submit_time"],
            mobileFields: ["your-email", "phone", "lead-type", "use-case", "form-url", "utm_source", "utm_medium", "submit_time"],
            copyFields: ["Your Name", "Phone", "Your Email", "Company Website", "Use Case", "Employees", "Call Minutes", "Your Message", "Form Url", "Submit Time", "User Ip"],
            pk92Cols: [["Name", "your-name"], ["Email", "your-email"], ["Phone", "phone"], ["Company", "company-website"], ["Submit Time", "submit_time"]],
            pk92ExportCols: ["your-name", "your-email", "phone", "company-website", "use-case", "submit_time"],
            leadType: true,
        },
    };
    /* "YYYY-MM-DD HH:MM:SS" UTC → same format in IST (+05:30); anything else is left as-is */
    function utcToIst(v) {
        const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
        if (!m) return v;
        const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 330 * 60000);
        return d.toISOString().slice(0, 19).replace("T", " ");
    }
    function site() { return SITE_PROFILES[activeDb] || SITE_PROFILES.landing; }
    function getPhone(row) { return row[site().phoneCol]; }
    function normalizeRows(rows) {
        const fn = site().normalize;
        if (fn) rows.forEach(fn);
        return rows;
    }
    function siteColumns(cols, rows) {
        const p = site();
        let out = cols.filter(c => !p.dropCols.includes(c));
        if (p.normalize && rows.length) {
            Object.keys(rows[0]).forEach(c => { if (!out.includes(c)) out.push(c); });
        }
        /* The name cell opens the lead detail modal, so keep it even when the range only has nameless (email-only) Botphonic rows */
        if (p.normalize && !out.includes("your-name")) out.unshift("your-name");
        if (p.columnOrder) {
            const first = p.columnOrder.filter(c => out.includes(c));
            out = [...first, ...out.filter(c => !first.includes(c))];
        }
        return out;
    }

    /* Table sort state - persists across filter changes */
    let sortState = { col: null, dir: 1 };  // dir: 1 = asc, -1 = desc

    /* ═══ DATE DEFAULTS ═══ */
    /* Default range = last 3 days. Recomputed on Reset, so a tab left open overnight doesn't reuse yesterday's "today". */
    function setDefaultRange() {
        const today = new Date();
        const fromDate = new Date();
        fromDate.setDate(today.getDate() - 2);
        document.getElementById("from").value = fmt(fromDate);
        document.getElementById("to").value = fmt(today);
    }
    setDefaultRange();
    /* Local calendar date (IST on the team's PCs). toISOString() is UTC and shifted ranges back a day. */
    function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
    /* "2026-10-27" → "27 Oct 2026" for display; anything unparseable is shown as-is */
    /* "Today · 2 Nov" / "Yesterday · 1 Nov" / "Sat · 31 Oct" for the Date Wise card */
    function dayLabel(v) {
        const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return v || "";
        const d = new Date(+m[1], m[2] - 1, +m[3]);
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const diff = Math.round((t - d) / 86400000);
        const name = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
        return `${name} · ${+m[3]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m[2] - 1]}${d.getFullYear() !== t.getFullYear() ? " " + m[1] : ""}`;
    }

    function prettyDate(v) {
        const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return v || "";
        return `${+m[3]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m[2] - 1]} ${m[1]}`;
    }

    /* ═══ DOM REFS ═══ */
    const loaderWrap = document.getElementById("loaderWrap");
    const tableHead = document.getElementById("tableHead");
    const tableBody = document.getElementById("tableBody");
    const tableSearch = document.getElementById("tableSearch");
    const emptyState = document.getElementById("emptyState");
    const mainTable = document.getElementById("mainTable");
    const pageEl = document.querySelector("main.page");
    const loadErrorEl = document.getElementById("loadError");
    let loadSeq = 0;           // see loadData()
    let loadAbort = null;
    const statusBadge = document.getElementById("statusBadge");
    const colPills = document.getElementById("colPills");
    const colSelectorHdr = document.getElementById("colSelectorHdr");
    const filterStrip = document.getElementById("filterStrip");
    const filterChips = document.getElementById("filterChips");
    const presetBtns = document.querySelectorAll(".preset-btn");

    /* ═══ COLUMN SELECTOR ═══ */
    /* "Columns" button in the table toolbar opens the panel (presets + pills) below it */
    const colPanel = document.getElementById("colPanel");
    colSelectorHdr.addEventListener("click", e => {
        if (e.target.closest("#colSelectorActions")) return;
        const open = colSelectorHdr.classList.toggle("open");
        colPills.classList.toggle("visible", open);
        colPanel.classList.toggle("visible", open);
        colSelectorHdr.setAttribute("aria-expanded", open ? "true" : "false");
    });

    /* ═══ BREAKDOWNS SECTION - collapsible, remembered per browser ═══ */
    const INSIGHTS_KEY = "reportInsightsCollapsed";
    const insights = document.getElementById("insights");
    const insightsToggle = document.getElementById("insightsToggle");
    function setInsightsCollapsed(collapsed) {
        insights.classList.toggle("collapsed", collapsed);
        insightsToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    try { setInsightsCollapsed(localStorage.getItem(INSIGHTS_KEY) === "1"); } catch (e) { /* ignore */ }
    insightsToggle.addEventListener("click", () => {
        const collapsed = !insights.classList.contains("collapsed");
        setInsightsCollapsed(collapsed);
        try { localStorage.setItem(INSIGHTS_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
    });
    document.getElementById("btnShowAll").addEventListener("click", e => {
        e.stopPropagation();
        allColumns.forEach(c => visibleCols.add(c));
        applyVisibility();
    });
    document.getElementById("btnHideAll").addEventListener("click", e => {
        e.stopPropagation();
        visibleCols.clear();
        if (allColumns.includes("your-name")) visibleCols.add("your-name");   // keep a way to open each lead
        applyVisibility();
    });
    document.getElementById("btnReset").addEventListener("click", e => {
        e.stopPropagation();
        visibleCols = new Set(defaultShowCols);
        applyVisibility();
    });
    document.getElementById("btnCompact").addEventListener("click", e => {
        e.stopPropagation();
        const compactCols = site().compactCols.filter(c => allColumns.includes(c));
        visibleCols = new Set(compactCols.length ? compactCols : defaultShowCols);
        applyVisibility();
    });

    /* ═══ DATA SOURCE SWITCH (Healthray / Botphonic) ═══ */
    const dbSwitch = document.getElementById("dbSwitch");

    function setActiveDbButton(db) {
        dbSwitch.querySelectorAll(".db-switch-btn").forEach(btn => {
            const isActive = btn.dataset.db === db;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
    }
    /* Site-specific chrome: Lead Type card (Botphonic only) + the Organic/Ads rule hint */
    function applySiteLayout() {
        const p = site();
        document.getElementById("bc-leadtype").hidden = !p.leadType;
        document.getElementById("cardBigBed").hidden = !p.bedCol;
        document.querySelector(".breakdown-bar").classList.toggle("six", p.leadType);
        document.querySelector("#bc-adtype .breakdown-hdr-text strong").title = p.adsHint;
    }
    applySiteLayout();

    setActiveDbButton(activeDb); // reflect a restored (non-default) selection before the first load

    dbSwitch.addEventListener("click", e => {
        const btn = e.target.closest(".db-switch-btn");
        if (!btn || btn.dataset.db === activeDb) return;

        activeDb = btn.dataset.db;
        try { localStorage.setItem(DB_KEY, activeDb); } catch (e) { /* ignore */ }
        setActiveDbButton(activeDb);

        /* Switching source is a full reload of this dashboard's data - the previous DB's rows/comparison must never linger and get mixed in. */
        compareRows = null;
        compareDupMeta = {};
        compareFilteredRows = null;
        visibleCols = new Set();
        sortState = { col: null, dir: 1 };
        clearAllFilters();
        applySiteLayout();
        loadData();
    });

    /* ═══ FORM / SEARCH ═══ */
    document.getElementById("filterForm").addEventListener("submit", e => {
        e.preventDefault();
        closeAllDropdowns();
        loadData();
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
        setDefaultRange();
        tableSearch.value = "";
        clearAllFilters();
        setActivePreset(null);
        closeAllDropdowns();
        loadData();
    });
    let searchTimer;
    tableSearch.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 150); });

    /* Search shortcut - "/" (when not already typing in a field) or Ctrl/Cmd+K, like Slack. Esc clears and leaves the box. */
    document.addEventListener("keydown", e => {
        const typing = e.target.closest("input, textarea, select, [contenteditable]");
        const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
        if (isCtrlK || (e.key === "/" && !typing)) {
            e.preventDefault();
            tableSearch.focus();
            tableSearch.select();
        }
    });
    tableSearch.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (tableSearch.value) { tableSearch.value = ""; applyFilters(); }
        tableSearch.blur();
    });

    /* ═══ DATE RANGE PRESETS ═══ */
    presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const days = parseInt(btn.dataset.days, 10);
            const offset = parseInt(btn.dataset.offset || "0", 10);   // days back the range ends - "Yesterday" = 1
            const toD = new Date();
            toD.setDate(toD.getDate() - offset);
            const fromD = new Date(toD);
            fromD.setDate(toD.getDate() - (days - 1));
            document.getElementById("from").value = fmt(fromD);
            document.getElementById("to").value = fmt(toD);
            setActivePreset(btn);
            closeAllDropdowns();
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
    /* Date button label - "Today · 2 Nov 2026" for a preset, just the range for custom dates. Set from refreshStats so it follows the LOADED data, not dates still being typed. */
    function updateDateToggle() {
        const from = document.getElementById("from").value, to = document.getElementById("to").value;
        const active = [...presetBtns].find(b => b.classList.contains("active"));
        document.getElementById("dateTogglePreset").textContent = active ? active.textContent : "";
        document.getElementById("dateToggleRange").textContent = from === to ? prettyDate(from) : `${prettyDate(from)} – ${prettyDate(to)}`;
    }

    /* ═══ DUP FILTER CARDS ═══ */
    document.getElementById("cardDupEmail").addEventListener("click", () => toggleDupFilter("email"));
    document.getElementById("cardDupPhone").addEventListener("click", () => toggleDupFilter("phone"));
    document.getElementById("cardDupTime").addEventListener("click", () => toggleDupFilter("time"));
    document.getElementById("cardOutsideIndia").addEventListener("click", toggleIntlFilter);
    document.getElementById("cardBigBed").addEventListener("click", toggleBigBedFilter);
    document.getElementById("clearDupFilter").addEventListener("click", () => { clearAllFilters(); applyFilters(); });

    /* +92 (Pakistan/test) data lives in its own panel, entirely separate from the dup OR-filter set - it's a data-quality segregation, not a lead filter. */
    document.getElementById("cardDupPk92").addEventListener("click", () => {
        document.getElementById("pk92Panel").classList.toggle("open");
    });
    document.getElementById("pk92PanelClose").addEventListener("click", () => {
        document.getElementById("pk92Panel").classList.remove("open");
    });

    /* ═══ COMPARISON DELTA - click to expand full details ═══ (primary metric stays a plain percentage; date range + previous-period count live in this secondary panel) */
    document.getElementById("statTotalDelta").addEventListener("click", () => {
        document.getElementById("statTotalDeltaDetail").classList.toggle("open");
    });

    /* ═══ DROPDOWN COMPONENT ═══ */
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

    /* Status pill - data-state drives the coloured dot (live / loading / truncated / error) */
    function setStatus(state, label) {
        statusBadge.dataset.state = state;
        document.getElementById("statusText").textContent = label;
    }

    /* "Updated x min ago" next to the refresh button - so nobody acts on a stale tab without knowing it */
    let lastLoadedAt = null;
    const lastUpdatedEl = document.getElementById("lastUpdated");
    function updateLastUpdated() {
        if (lastLoadedAt) lastUpdatedEl.textContent = ` · ${relativeTime(lastLoadedAt)}`;
    }
    document.getElementById("refreshBtn").addEventListener("click", loadData);

    /* FETCH */
    /* Only the newest request may render: rapid preset / refresh / DB clicks used to let an older, slower response land last */
    async function loadData() {
        const mySeq = ++loadSeq;
        compareRequestId++;                       // a comparison still in flight belongs to the old range / DB
        if (loadAbort) loadAbort.abort();
        loadAbort = new AbortController();
        document.getElementById("refreshBtn").classList.add("spinning");
        showLoader(true);
        showLoadError(null);
        pageEl.classList.add("is-loading");      // previous range's numbers stay visible but dimmed
        setStatus("loading", "Loading…");
        try {
            const res = await fetch("./../api/get_report.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: loadAbort.signal,
                body: JSON.stringify({
                    db: activeDb,
                    from: document.getElementById("from").value,
                    to: document.getElementById("to").value,
                })
            });
            const data = await readJson(res);
            if (mySeq !== loadSeq) return;
            if (data.status !== "success") throw new Error(data.error || "API returned an error");
            pageEl.classList.remove("is-loading", "is-stale");
            renderAll(data);
            lastLoadedAt = Date.now();
            updateLastUpdated();
            loadComparison();
            if (data.truncated) {
                showToast(`Showing first ${data.limit.toLocaleString()} rows - narrow the date range to see all`, "error");
                setStatus("truncated", "Truncated");
            } else {
                showToast(`Loaded ${(data.rows || []).length} rows`, "success");
                setStatus("live", "Live");
            }
        } catch (err) {
            if (mySeq !== loadSeq) return;        // superseded (incl. aborted) - the newer request owns the UI
            console.error(err);
            /* The cards still hold the previous range - keep them dimmed and locked so nobody reads them as the new dates */
            pageEl.classList.remove("is-loading");
            pageEl.classList.add("is-stale");
            showLoadError(err.message);
            showToast(err.message, "error");
            setStatus("error", "Error");
        } finally {
            if (mySeq === loadSeq) {
                showLoader(false);
                document.getElementById("refreshBtn").classList.remove("spinning");
            }
        }
    }

    /* Parse a get_report.php response. A PHP warning / plain-text die() / proxy error page used to surface as "Unexpected token '<'". */
    async function readJson(res) {
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(res.ok ? "The server sent an unreadable response - try again" : `Server error (HTTP ${res.status}) - try again in a moment`);
        }
    }

    function showLoadError(msg) {
        loadErrorEl.hidden = !msg;
        if (msg) {
            document.getElementById("loadErrorMsg").textContent = msg;
            mainTable.style.visibility = "hidden";
            emptyState.classList.remove("visible");
        }
    }
    document.getElementById("loadErrorRetry").addEventListener("click", loadData);

    /* ═══ PERIOD-OVER-PERIOD COMPARISON ═══ Fetches the immediately preceding period of equal length (e.g. this week vs last week). Every active filter (search, dup flags, source, campaign, date, page, adtype) is re-applied to the previous period identically, so every metric - totals, dup counts, breakdown items - compares like-for-like. */
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
            body: JSON.stringify({ db: activeDb, from, to })
        });
        return readJsonRows(res);
    }
    async function readJsonRows(res) {
        if (!res.ok) throw new Error(`Server error - HTTP ${res.status}`);
        const data = await readJson(res);
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
            compareRows = normalizeRows(rawRows).filter(r => !isTestLead(r));
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
        [["statTotalDelta", "statTotalDeltaDetail"]].forEach(([dId, detId]) => {
            const el = document.getElementById(dId);
            const det = document.getElementById(detId);
            el.textContent = "…";
            el.className = "stat-delta flat";
            el.removeAttribute("title");
            if (det) { det.innerHTML = ""; det.classList.remove("open"); }
        });
    }

    /* Primary metric is percentage-only (e.g. "▼ -63%"); full detail (date range + previous count) goes in the tooltip and, for the two headline KPIs, an expandable detail panel below the metric. */
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

    /* Small "vs previous period" badge for breakdown rows - prevMap is already built from compareFilteredRows, so it's scoped by every other active filter exactly like the current-side count is. */
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

    /* ═══ +92 / PAKISTAN-TEST DETECTION ═══ Numbers beginning with +92 / 0092 are data-entry/testing records - detected once, then fully removed from originalRows (and everything derived from it: dedup, breakdowns, comparison, KPIs) and rendered separately in their own panel. */
    function isPk92Number(v) {
        if (v == null || v === "") return false;
        const cleaned = String(v).trim().replace(/[\s\-().]/g, "");
        return /^(\+92|0092)/.test(cleaned);
    }
    /* Pakistan / Test = +92 number, an internal @bigscal.com email, or "test" as a word in the name */
    function isTestLead(row) {
        if (isPk92Number(getPhone(row))) return true;
        if (/@bigscal\.com\s*$/i.test(String(row["your-email"] ?? ""))) return true;
        return /\btest\b/i.test(String(row["your-name"] ?? ""));
    }

    /* "Outside India" filter - numbers NOT beginning with +91 / 0091. Unlike +92, these rows are NOT excluded from analytics - this is just a lens on the existing dataset, same as the Source/Campaign filters. */
    function isNonIndiaNumber(v) {
        const k = phoneKey(v);
        return k != null && !k.startsWith("91");
    }

    /* 100+ beds - "101 – 300 beds" ("lg") or "300+ or a group" ("xl"). Read off the numbers in the label or the word "group", so a reworded option such as "101-300" or "Hospital group" still matches. Healthray only. */
    function bedTier(row) {
        const col = site().bedCol;
        if (!col) return null;
        const v = String(row[col] ?? "");
        if (/group/i.test(v)) return "xl";
        const nums = (v.match(/\d+/g) || []).map(Number);
        const max = nums.length ? Math.max(...nums) : 0;
        if (max > 300 || (max === 300 && /\+/.test(v))) return "xl";
        if (max > 100) return "lg";
        return null;
    }
    function isBigBedLead(row) { return bedTier(row) !== null; }

    const BED_TIER = {
        lg: { icon: "★", label: "101–300 Beds" },
        xl: { icon: "♛", label: "300+ / Group" },
    };
    function bigBedBadge(tier, row) {
        const t = BED_TIER[tier];
        return `<span class="bigbed-badge ${tier}" title="High-value lead · ${esc(rawValue(site().bedCol, row))}"><span class="bb-ico" aria-hidden="true">${t.icon}</span>${t.label}</span>`;
    }

    /* DUPLICATE ANALYSIS - rows passed in never include +92 rows, so no exclusion logic is needed here. Besides the email / phone / time flags, each flagged row keeps its group (meta.groups[type]): every row sharing that value, oldest first, the row itself included. The groups drive the "(3)" counts, the "also …" times and the duplicates list in the lead modal. */
    function dupKey(type, row) {
        if (type === "email") return norm(row["your-email"]);
        if (type === "phone") return phoneKey(getPhone(row));
        return norm(row["submit_time"]);
    }
    function analyseDuplicates(rows) {
        const byType = {};
        DUP_TYPES.forEach(type => {
            const map = new Map();
            rows.forEach(r => {
                const k = dupKey(type, r);
                if (!k) return;
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(r);
            });
            map.forEach(list => { if (list.length > 1) list.sort(bySubmitTime); });
            byType[type] = map;
        });
        const meta = {};
        rows.forEach((row, i) => {
            const m = { email: false, phone: false, time: false, groups: {} };
            DUP_TYPES.forEach(type => {
                const k = dupKey(type, row);
                const list = k ? byType[type].get(k) : null;
                if (list && list.length > 1) { m[type] = true; m.groups[type] = list; }
            });
            meta[i] = m;
        });
        return meta;
    }
    /* Oldest first; rows without a readable submit time go last */
    function bySubmitTime(a, b) {
        const da = parseSubmitTime(a["submit_time"]), db = parseSubmitTime(b["submit_time"]);
        const x = da ? da.getTime() : Infinity, y = db ? db.getTime() : Infinity;
        return x === y ? 0 : x < y ? -1 : 1;
    }
    /* This row's group for one check (oldest first, the row itself included) - [] when it isn't a duplicate of that kind */
    function dupGroup(row, type) {
        const m = dupMeta[originalRows.indexOf(row)];
        return (m && m.groups[type]) || [];
    }
    /* Every row sharing the email, phone OR exact submit time with this one, oldest first, the row itself included - [] for a lead without duplicates */
    function dupFamily(row) {
        const m = dupMeta[originalRows.indexOf(row)];
        if (!m) return [];
        const set = new Set();
        DUP_TYPES.forEach(t => (m.groups[t] || []).forEach(r => set.add(r)));
        return set.size > 1 ? [...set].sort(bySubmitTime) : [];
    }

    const DUP_WHAT = { email: "email", phone: "phone number", time: "submit time" };
    const DUP_MATCH_LABEL = { email: "Same email", phone: "Same phone", time: "Same time" };
    /* "DUP (3) ›" - a button that opens the lead with its duplicates list. (3) = submissions sharing this email / phone / time in the selected dates, this one included; the tooltip lists them all. */
    function dupTagHtml(row, type, group) {
        const lines = group.map((r, i) => {
            const label = type === "time" ? (r["your-name"] || r["your-email"] || "(no name)") : whenFull(r);
            return `${i + 1}. ${label}${r === row ? "  (this lead)" : ""}`;
        });
        const tip = `Same ${DUP_WHAT[type]} - ${group.length} submissions in the selected dates:\n${lines.join("\n")}\nClick to open and compare them`;
        return `<button type="button" class="dup-tag ${type}" data-dup-row="${allRows.indexOf(row)}" title="${esc(tip)}">${type === "time" ? "same" : "dup"} (${group.length})<span class="dup-go" aria-hidden="true">›</span></button>`;
    }
    /* "also 12 Nov 09:10 · Yesterday 18:04" - when the other submissions with this email / phone came in */
    function dupAlsoHtml(row, group) {
        const others = group.filter(r => r !== row);
        if (!others.length) return "";
        return `<span class="dup-also" title="${esc("Also submitted: " + others.map(whenFull).join(", "))}">also ${esc(others.map(whenShort).join(" · "))}</span>`;
    }
    function whenShort(row) { const p = submitTimeParts(row["submit_time"]); return p ? p.short : (row["submit_time"] || "unknown time"); }
    function whenFull(row) { const p = submitTimeParts(row["submit_time"]); return p ? p.abs : (row["submit_time"] || "unknown time"); }
    /* Digits only, so "+44 7828 735346" and "+447828735346" count as the same number */
    /* Also canonicalises Indian numbers, so "+91 98765 43210", "098765 43210" and "9876543210" count as one number (a bare 10-digit number is treated as +91, like the WhatsApp action) */
    function phoneKey(v) {
        const raw = String(v ?? "").trim();
        let d = raw.replace(/\D/g, "");
        if (d.length < 6) return null;
        if (!raw.startsWith("+")) {
            if (d.startsWith("00")) d = d.slice(2);                                // 0091… / 0044…
            else if (d.length === 11 && d[0] === "0") d = "91" + d.slice(1);       // 098765 43210
            else if (d.length === 10) d = "91" + d;                                // 9876543210
        }
        return d;
    }
    function norm(v) { return (v == null || v === "") ? null : String(v).trim().toLowerCase(); }

    /* BREAKDOWN HELPERS extractUtmVal - resolve UTM param from raw column value getRowDate - extract YYYY-MM-DD from a row's time fields */
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

    /* Page the form was submitted from - shown as the URL path (e.g. "/emr-software/"). Healthray logs this as "page-name"/"handl_url_cf7-264"; Botphonic's CF7 setup has no equivalent of those two keys at all, so without a fallback this always reads "(unknown)" for Botphonic even though the same URL is captured under "handl_url_base_cf7" (or "full_url" on a different form variant). */
    function getPageName(row) {
        const key = site().pageKeys.find(k => row[k]);
        const raw = key ? row[key] : "";
        if (!raw) return "(unknown)";
        try {
            const path = new URL(String(raw)).pathname;
            return path === "" || path === "/" ? "(home)" : path;
        } catch { return String(raw); }
    }

    /* Organic vs Ads - driven purely by utm_campaign. A row with a real utm_campaign value counts as "Ads"; a row with no campaign (empty, or a tracking placeholder that was never filled in such as "(not set)", "undefined", "{campaign}") counts as "Organic". The value is resolved the same way as the UTM Campaign widget (extractUtmVal), so both widgets always agree. */
    const EMPTY_CAMPAIGN_VALUES = new Set(["", "(none)", "(not set)", "not set", "(direct)", "none", "null", "undefined", "-", "n/a", "na"]);
    function hasUtmCampaign(row) {
        const val = extractUtmVal(row["utm_campaign"], "utm_campaign").trim().toLowerCase();
        if (EMPTY_CAMPAIGN_VALUES.has(val)) return false;
        if (/^\{.*\}$/.test(val)) return false;   // unreplaced macro, e.g. {campaign}
        return true;
    }
    function getAdType(row) {
        return site().isAds(row) ? "Ads" : "Organic";
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
            } else if (dimension === "leadtype") {
                key = row["lead-type"] || "(unknown)";
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
        } else if (dimension === "page") {
            // A → Z so a page is easy to find when ticking several; "(unknown)" goes last
            entries.sort((a, b) => (a.value === "(unknown)") - (b.value === "(unknown)") || a.value.localeCompare(b.value, undefined, { sensitivity: "base", numeric: true }));
        } else {
            entries.sort((a, b) => b.count - a.count);
        }
        return entries;
    }

    /* RENDER ALL  (called once per loadData) */
    function renderAll(data) {
        allRows = normalizeRows(data.rows || []);
        allColumns = siteColumns(data.allColumns || [], allRows);

        /* Split off +92 (Pakistan/test) rows FIRST - everything downstream (dedup, breakdowns, KPIs, comparisons) only ever sees originalRows. */
        pk92Rows = allRows.filter(r => isTestLead(r));
        originalRows = allRows.filter(r => !isTestLead(r));

        defaultShowCols = site().defaultShow ? site().defaultShow.filter(c => allColumns.includes(c)) : (data.defaultShow || allColumns);
        dupMeta = analyseDuplicates(originalRows);

        if (visibleCols.size === 0) visibleCols = new Set(defaultShowCols);

        buildPills();
        updateActivePreset();
        renderHead();
        filteredRows = sortRows([...originalRows]);
        renderBody();
        renderPk92Panel();
        refreshStats();          // stat cards + breakdown cards
        updatePagination();
    }

    /* ═══ +92 / PAKISTAN-TEST PANEL ═══ Its own section, entirely outside the filtered dataset - never counted in totals, dup counts, breakdowns or comparisons. */
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
                ${site().pk92Cols.map(([label]) => `<th>${label}</th>`).join("")}<th>Page</th>
            </tr></thead><tbody>` +
            pk92Rows.map(row => `<tr>
                ${site().pk92Cols.map(([, col]) => `<td>${esc(rawValue(col, row) || "-")}</td>`).join("")}
                <td>${esc(getPageName(row))}</td>
            </tr>`).join("") +
            `</tbody></table>`;
    }

    /* ═══ ACTIVE FILTER STATE + UNIFIED FILTERING ═══ One function, shared by the current period AND the comparison period, so both are always filtered identically. */
    function hasActiveFilters(state) {
        return !!(state.keyword || (state.dupFilters && state.dupFilters.size) || state.source || state.campaign || state.date || state.page || state.adtype || state.leadtype || state.intl || state.bigBed);
    }

    function getActiveFilterState() {
        return {
            keyword: tableSearch.value.toLowerCase().trim(),
            dupFilters: activeDupFilters,
            source: activeSourceFilter,
            campaign: activeCampaignFilter,
            date: activeDateFilter,
            page: activePageFilter.size ? new Set(activePageFilter) : null,
            adtype: activeAdtypeFilter,
            leadtype: activeLeadtypeFilter,
            intl: activeIntlFilter,
            bigBed: activeBigBedFilter,
        };
    }

    /* Applies every filter in `state` to `rows`, using `meta` (a dupMeta-shaped map keyed by index into `rows`) for the dup conditions. Works for either (originalRows, dupMeta) or (compareRows, compareDupMeta). */
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
            out = out.filter(row => state.page.has(getPageName(row)));
        }
        if (state.adtype) {
            out = out.filter(row => getAdType(row) === state.adtype);
        }
        if (state.leadtype) {
            out = out.filter(row => row["lead-type"] === state.leadtype);
        }
        if (state.intl) {
            out = out.filter(row => isNonIndiaNumber(getPhone(row)));
        }
        if (state.bigBed) {
            out = out.filter(isBigBedLead);
        }
        return out;
    }

    /* ═══ REFRESH STATS ═══ Called after EVERY filter change and after every comparison load so every KPI, dup count, and breakdown card - current AND previous period - always reflects the same active filters. */
    function refreshStats() {
        const fromVal = document.getElementById("from").value;
        const toVal = document.getElementById("to").value;
        updateDateToggle();
        document.getElementById("tableHdrMeta").textContent = fromVal === toVal ? prettyDate(fromVal) : `${prettyDate(fromVal)} → ${prettyDate(toVal)}`;

        const state = getActiveFilterState();

        document.getElementById("statTotal").textContent = filteredRows.length;
        refreshTodayCard();
        document.getElementById("tableHdrCount").textContent = filteredRows.length;

        /* Dup counts scoped by every OTHER active filter (source/campaign/date/ page/adtype/search) but not by the dup toggles themselves - e.g. Source=Ads narrows "Dup. Email" down to Ads-only duplicates. */
        const nonDupState = { ...state, dupFilters: new Set() };
        const scopedRows = computeFilteredRows(originalRows, dupMeta, nonDupState);
        const dupEmailCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.email).length;
        const dupPhoneCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.phone).length;
        const dupTimeCount = scopedRows.filter(row => dupMeta[originalRows.indexOf(row)]?.time).length;
        document.getElementById("statDupEmail").textContent = dupEmailCount;
        document.getElementById("statDupPhone").textContent = dupPhoneCount;
        document.getElementById("statDupTime").textContent = dupTimeCount;
        /* Dropdown button shows rows flagged by ANY of the three */
        const dupAnyCount = scopedRows.filter(row => { const m = dupMeta[originalRows.indexOf(row)]; return m && (m.email || m.phone || m.time); }).length;
        document.getElementById("statDupAny").textContent = dupAnyCount;
        document.getElementById("dupDdToggle").classList.toggle("has-dups", dupAnyCount > 0);

        /* Outside India count scoped by every OTHER active filter, same pattern as the dup counts above - so e.g. Source=Ads narrows it to Ads-only. */
        const nonIntlState = { ...state, intl: false };
        const scopedForIntl = computeFilteredRows(originalRows, dupMeta, nonIntlState);
        const intlCount = scopedForIntl.filter(row => isNonIndiaNumber(getPhone(row))).length;
        document.getElementById("statOutsideIndia").textContent = intlCount;

        /* 100+ Beds count - same "every OTHER filter" scoping as Outside India */
        const nonBigBedState = { ...state, bigBed: false };
        const bigBedRows = computeFilteredRows(originalRows, dupMeta, nonBigBedState).filter(isBigBedLead);
        const bigBedCount = bigBedRows.length;
        const xlCount = bigBedRows.filter(r => bedTier(r) === "xl").length;
        document.getElementById("statBigBed").textContent = bigBedCount;
        document.getElementById("statBigBedLg").textContent = bigBedCount - xlCount;
        document.getElementById("statBigBedXl").textContent = xlCount;
        document.getElementById("cardBigBed").classList.toggle("has-leads", bigBedCount > 0);

        if (compareRows != null) {
            setDeltaText(
                document.getElementById("statTotalDelta"),
                filteredRows.length, (compareFilteredRows || compareRows).length, lastPrevRange,
                document.getElementById("statTotalDeltaDetail")
            );

            const scopedPrevRows = computeFilteredRows(compareRows, compareDupMeta, nonDupState);
            const prevDupEmailCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.email).length;
            const prevDupPhoneCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.phone).length;
            const prevDupTimeCount = scopedPrevRows.filter(row => compareDupMeta[compareRows.indexOf(row)]?.time).length;
            setDeltaText(document.getElementById("statDupEmailDelta"), dupEmailCount, prevDupEmailCount, lastPrevRange);
            setDeltaText(document.getElementById("statDupPhoneDelta"), dupPhoneCount, prevDupPhoneCount, lastPrevRange);
            setDeltaText(document.getElementById("statDupTimeDelta"), dupTimeCount, prevDupTimeCount, lastPrevRange);

            const scopedPrevForIntl = computeFilteredRows(compareRows, compareDupMeta, nonIntlState);
            const prevIntlCount = scopedPrevForIntl.filter(row => isNonIndiaNumber(getPhone(row))).length;
            setDeltaText(document.getElementById("statOutsideIndiaDelta"), intlCount, prevIntlCount, lastPrevRange);

            const prevBigBedCount = computeFilteredRows(compareRows, compareDupMeta, nonBigBedState).filter(isBigBedLead).length;
            setDeltaText(document.getElementById("statBigBedDelta"), bigBedCount, prevBigBedCount, lastPrevRange);
        } else {
            ["statTotalDelta", "statDupEmailDelta", "statDupPhoneDelta", "statDupTimeDelta", "statOutsideIndiaDelta", "statBigBedDelta"].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.textContent = ""; el.className = "stat-delta"; el.removeAttribute("title"); }
            });
        }

        /* Breakdown cards - ALWAYS computed from filteredRows/compareFilteredRows so counts (current AND previous) update reactively with every filter. */
        refreshBreakdownCard("bc-campaign", "utm_campaign", "campaign", activeCampaignFilter);
        refreshBreakdownCard("bc-source", "utm_source", "source", activeSourceFilter);
        refreshBreakdownCard("bc-date", "date", "date", activeDateFilter);
        refreshBreakdownCard("bc-page", "page", "page", activePageFilter, true);
        refreshBreakdownCard("bc-adtype", "adtype", "adtype", activeAdtypeFilter);
        if (site().leadType) refreshBreakdownCard("bc-leadtype", "leadtype", "leadtype", activeLeadtypeFilter);
    }

    /* ═══ TODAY CARD ═══ Real leads submitted today vs yesterday up to the same time of day - "are we on pace?". Reads the loaded range plus the comparison period, so it also works on the "Today" quick range (yesterday is then the comparison period). */
    function refreshTodayCard() {
        const valEl = document.getElementById("statToday");
        const deltaEl = document.getElementById("statTodayDelta");
        const hintEl = document.getElementById("statTodayHint");
        const now = new Date();
        const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const todayStr = ymd(now);
        const y = new Date(now); y.setDate(now.getDate() - 1);
        const yStr = ymd(y);
        const from = document.getElementById("from").value, to = document.getElementById("to").value;

        deltaEl.textContent = "";
        deltaEl.className = "stat-delta no-suffix";
        if (todayStr < from || todayStr > to) {
            valEl.textContent = "-";
            hintEl.textContent = "Today is outside the selected dates";
            return;
        }
        const pool = compareRows ? originalRows.concat(compareRows) : originalRows;
        const todayCount = pool.filter(r => getRowDate(r) === todayStr).length;
        valEl.textContent = todayCount;

        /* Yesterday is only known if it's in the loaded range or the comparison period */
        const haveYesterday = yStr >= from || (compareRows && lastPrevRange && yStr >= lastPrevRange.from);
        if (!haveYesterday) { hintEl.textContent = "Leads since midnight"; return; }
        const cutoff = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const yCount = pool.filter(r => {
            if (getRowDate(r) !== yStr) return false;
            const d = parseSubmitTime(r["submit_time"]);
            return d && d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() <= cutoff;
        }).length;
        const diff = todayCount - yCount;
        deltaEl.textContent = diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : "▶ 0";
        deltaEl.classList.add(diff > 0 ? "up" : diff < 0 ? "down" : "flat");
        hintEl.textContent = `${yCount} by this time yesterday`;
    }

    /* ═══ REFRESH BREAKDOWN CARD ═══ Re-renders list items from current filteredRows, with a vs-previous-period delta per item built from compareFilteredRows (already scoped by every other active filter). */
    /* multi = multi-select card (activeVal is a Set). Its counts ignore its OWN filter (every other filter still applies), otherwise picking one page would hide all the others and you could never pick a second. */
    function refreshBreakdownCard(cardId, dimension, filterKey, activeVal, multi = false) {
        const card = document.getElementById(cardId);
        const list = card.querySelector(".breakdown-list");
        const uniq = card.querySelector(".breakdown-unique");

        let curRows = filteredRows, prevRows = compareFilteredRows;
        if (multi) {
            const scope = { ...getActiveFilterState(), [filterKey]: null };
            curRows = computeFilteredRows(originalRows, dupMeta, scope);
            prevRows = compareRows ? computeFilteredRows(compareRows, compareDupMeta, scope) : null;
        }

        const items = buildBreakdown(curRows, dimension);
        uniq.textContent = multi && activeVal.size ? `${activeVal.size} selected · ${items.length} unique` : `${items.length} unique`;

        let prevMap = null;
        if (prevRows) {
            prevMap = {};
            buildBreakdown(prevRows, dimension).forEach(({ value, count }) => { prevMap[value] = count; });
        }

        const isDate = dimension === "date";
        const maxCount = Math.max(1, ...items.map(i => i.count));
        list.innerHTML = items.map(({ value, count }) => {
            const isNone = value === "(none)" || value === "(unknown)";
            const isAct = multi ? activeVal.has(value) : value === activeVal;
            /* Dates never repeat between periods, so a per-day delta is always "new" - show a volume bar instead */
            const deltaHtml = isDate
                ? `<span class="bi-bar" aria-hidden="true"><i style="width:${Math.round(count / maxCount * 100)}%"></i></span>`
                : buildDeltaBadge(prevMap, value, count);
            const label = isNone ? `<em>${value}</em>` : isDate ? esc(dayLabel(value)) : esc(value);

            return `<div class="breakdown-item${isAct ? " active" : ""}"
                         data-filter-key="${filterKey}"
                         data-value="${esc(value)}">
                        <span class="bi-label">${label}</span>
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
        if (filterKey === "page") { if (activePageFilter.has(val)) activePageFilter.delete(val); else activePageFilter.add(val); }
        if (filterKey === "adtype") activeAdtypeFilter = activeAdtypeFilter === val ? null : val;
        if (filterKey === "leadtype") activeLeadtypeFilter = activeLeadtypeFilter === val ? null : val;

        updateFilterStrip();

        /* Apply all filters → this rebuilds filteredRows, then refreshes all cards */
        applyFilters();
    }

    /* ═══ FILTER STRIP ═══ */
    const dupLabels = { email: "Dup Email", phone: "Dup Phone", time: "Same Time" };

    function updateFilterStrip() {
        /* Each chip carries its own removal handler so filters can be cleared individually without disturbing the others or the date range. */
        const chips = [];
        activeDupFilters.forEach(t => chips.push({ label: dupLabels[t], onRemove: () => toggleDupFilter(t) }));
        if (activeCampaignFilter) chips.push({ label: `Campaign: ${activeCampaignFilter}`, onRemove: () => { activeCampaignFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeSourceFilter) chips.push({ label: `Source: ${activeSourceFilter}`, onRemove: () => { activeSourceFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeDateFilter) chips.push({ label: `Date: ${activeDateFilter}`, onRemove: () => { activeDateFilter = null; updateFilterStrip(); applyFilters(); } });
        activePageFilter.forEach(p => chips.push({ label: `Page: ${p}`, onRemove: () => { activePageFilter.delete(p); updateFilterStrip(); applyFilters(); } }));
        if (activeAdtypeFilter) chips.push({ label: `Type: ${activeAdtypeFilter}`, onRemove: () => { activeAdtypeFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeLeadtypeFilter) chips.push({ label: `Lead: ${activeLeadtypeFilter}`, onRemove: () => { activeLeadtypeFilter = null; updateFilterStrip(); applyFilters(); } });
        if (activeIntlFilter) chips.push({ label: "Outside India", onRemove: () => toggleIntlFilter() });
        if (activeBigBedFilter) chips.push({ label: "100+ Beds", onRemove: () => toggleBigBedFilter() });

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

    /* ═══ DUP FILTER TOGGLE ═══ Email / Phone / Same-Time can all be active together - a row matching ANY active condition is shown (OR logic). */
    function toggleDupFilter(type) {
        if (activeDupFilters.has(type)) activeDupFilters.delete(type);
        else activeDupFilters.add(type);
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.toggle("active-filter", activeDupFilters.has(t))
        );
        document.getElementById("dupDdToggle").classList.toggle("active", activeDupFilters.size > 0);
        updateFilterStrip();
        applyFilters();
    }

    /* Outside-India toggle - a plain AND filter (like source/adtype), not part of the dup OR-set, since it's a country lens, not a duplicate flag. */
    function toggleIntlFilter() {
        activeIntlFilter = !activeIntlFilter;
        document.getElementById("cardOutsideIndia").classList.toggle("active-filter", activeIntlFilter);
        updateFilterStrip();
        applyFilters();
    }

    /* 100+ Beds toggle - plain AND filter, same as Outside India */
    function toggleBigBedFilter() {
        activeBigBedFilter = !activeBigBedFilter;
        document.getElementById("cardBigBed").classList.toggle("active-filter", activeBigBedFilter);
        updateFilterStrip();
        applyFilters();
    }

    function clearAllFilters() {
        activeDupFilters.clear();
        activeCampaignFilter = null;
        activeSourceFilter = null;
        activeDateFilter = null;
        activePageFilter.clear();
        activeAdtypeFilter = null;
        activeLeadtypeFilter = null;
        activeIntlFilter = false;
        activeBigBedFilter = false;
        ["email", "phone", "time"].forEach(t =>
            document.getElementById(`cardDup${cap(t)}`).classList.remove("active-filter")
        );
        document.getElementById("dupDdToggle").classList.remove("active");
        document.getElementById("cardOutsideIndia").classList.remove("active-filter");
        document.getElementById("cardBigBed").classList.remove("active-filter");
        updateFilterStrip();
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ═══ APPLY ALL FILTERS ═══ Rebuilds filteredRows AND compareFilteredRows from the exact same filter state, so the comparison never drifts from whatever the user is currently looking at. */
    function applyFilters() {
        const state = getActiveFilterState();
        filteredRows = sortRows(computeFilteredRows(originalRows, dupMeta, state));
        compareFilteredRows = compareRows ? computeFilteredRows(compareRows, compareDupMeta, state) : null;

        renderBody();
        refreshStats();
        updatePagination();
    }

    /* ═══ COLUMN PILLS ═══ */
    function buildPills() {
        colPills.innerHTML = allColumns.map(col => `
            <span class="col-pill ${visibleCols.has(col) ? "active" : ""}" data-col="${esc(col)}">
                ${esc(formatCol(col))}
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

    /* ═══ APPLY VISIBILITY ═══ */
    /* Up to WIDE_COL_LIMIT visible columns the table is squeezed to fit the card (no horizontal scroll). Beyond that (e.g. the "Full" preset) squeezing makes columns unreadable, so switch to natural widths + horizontal scroll with the first column pinned. */
    const WIDE_COL_LIMIT = 11;
    function updateTableMode() {
        const wide = getVisibleCols().length > WIDE_COL_LIMIT;
        mainTable.classList.toggle("wide", wide);
        mainTable.classList.toggle("bed-shown", !!site().bedCol && visibleCols.has(site().bedCol));
        mainTable.closest(".table-wrap").classList.toggle("wide", wide);
    }

    /* Highlight the preset whose column set matches what's on screen - none when pills were toggled by hand */
    function updateActivePreset() {
        const compactCols = site().compactCols.filter(c => allColumns.includes(c));
        const presets = {
            btnCompact: compactCols.length ? compactCols : defaultShowCols,
            btnReset: defaultShowCols,
            btnShowAll: allColumns,
            btnHideAll: [],
        };
        let matched = false;
        Object.entries(presets).forEach(([id, cols]) => {
            const isMatch = !matched && cols.length === visibleCols.size && cols.every(c => visibleCols.has(c));
            if (isMatch) matched = true;
            document.getElementById(id).classList.toggle("active", isMatch);
        });
    }

    function applyVisibility() {
        updateTableMode();
        updateActivePreset();
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

    /* ═══ RENDER HEAD (all columns sortable - click cycles asc/desc) ═══ */
    function renderHead() {
        updateTableMode();
        tableHead.innerHTML = "<tr>" +
            allColumns.map(col => {
                const isSortCol = sortState.col === col;
                const dirCls = isSortCol ? (sortState.dir === 1 ? " sort-asc" : " sort-desc") : "";
                const ind = isSortCol ? (sortState.dir === 1 ? "▲" : "▼") : "⇅";
                return `<th data-col="${esc(col)}" class="sortable${dirCls}" style="${visibleCols.has(col) ? "" : "display:none"}">${esc(formatCol(col))}<span class="sort-ind">${ind}</span></th>`;
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

    /* Generic sort: numeric compare when both sides parse as numbers, otherwise a case-insensitive string compare (works fine for the ISO-like submit_time format too). */
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

    /* ═══ RENDER BODY ═══ */
    /* +92 rows are shown inline with every other lead (so teammates can find their own test/SEO submissions), in their natural server order, but only highlighted - they never enter filteredRows, so no KPI counts them. */
    function buildDisplayRows() {
        const pkShown = new Set(computeFilteredRows(pk92Rows, {}, getActiveFilterState()));
        const counted = new Set(filteredRows);
        displayRows = sortRows(allRows.filter(r => counted.has(r) || pkShown.has(r)));
    }

    function renderBody() {
        buildDisplayRows();
        if (displayRows.length === 0) {
            mainTable.style.display = "none";
            emptyState.classList.add("visible");
            return;
        }
        mainTable.style.display = "";
        emptyState.classList.remove("visible");

        tableBody.innerHTML = displayRows.map(row => {
            const rowIdx = allRows.indexOf(row);
            const isPk = isTestLead(row);
            const dup = dupMeta[originalRows.indexOf(row)] || {};
            const bigBed = isPk ? null : bedTier(row);
            const rowCls = isPk ? "dup-pk92" : bigBed ? `big-bed ${bigBed}` : dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : "";

            const cells = allColumns.map(col => {
                const hidden = !visibleCols.has(col);
                const isName = col === "your-name";
                const isEmailCol = col === "your-email";
                const isPhoneCol = col === site().phoneCol;
                const isTimeCol = col === "submit_time";
                const isBedCol = col === site().bedCol;

                let cellDupCls = "", dupTag = "", cellHtml = null;
                /* Duplicate email / phone: the value on the first line, the "DUP (3)" button + when the other submissions came in on the second */
                const dupType = isEmailCol && dup.email ? "email" : isPhoneCol && dup.phone ? "phone" : null;
                if (dupType) {
                    const group = dup.groups[dupType];
                    cellDupCls = `dup-cell-${dupType}`;
                    cellHtml = `<span class="dup-val">${formatCell(col, row[col])}</span><span class="dup-meta">${dupTagHtml(row, dupType, group)}${dupAlsoHtml(row, group)}</span>`;
                }
                if (isTimeCol && dup.time) { cellDupCls = "dup-cell-time"; dupTag = dupTagHtml(row, "time", dup.groups.time); }
                if (isBedCol && bigBed) { cellDupCls = "bigbed-cell"; cellHtml = `<span class="bed-pill ${bigBed}">${esc(rawValue(col, row))}</span>`; }
                /* The bed-size field also collects billing-software answers ("Marg") - tag those so they aren't read as a size */
                if (isBedCol && !bigBed && isSoftwareAnswer(rawValue(col, row))) cellHtml = `${esc(rawValue(col, row))}<span class="soft-tag">Software</span>`;
                /* Flag the lead on the name too - CSS shows this badge only while the Bed Size column is hidden (it'd repeat the pill otherwise) */
                /* name + badge share one flex row: a long name ellipsises, the badge never gets clipped */
                if (isName && bigBed) cellHtml = `<span class="nm-wrap">${formatCell(col, row[col])}${bigBedBadge(bigBed, row)}</span>`;
                if (isPhoneCol && isPk) { cellDupCls = "dup-cell-pk92"; dupTag = `<span class="dup-tag pk92" title="Pakistan / Test - not counted in totals or analytics">PK/Test</span>`; }

                const cls = [tdClass(col), cellDupCls, isName ? "lead-name-link" : ""].filter(Boolean).join(" ");
                const rowAttr = isName ? ` data-row="${rowIdx}"` : "";
                return `<td data-col="${esc(col)}"${rowAttr} class="${cls}" title="${esc(rawValue(col, row))}" style="${hidden ? "display:none" : ""}">${cellHtml ?? formatCell(col, row[col])}${dupTag}</td>`;
            }).join("");

            return `<tr class="${rowCls}">${cells}</tr>`;
        }).join("");

        renderMobileCards();
    }

    /* ═══ MOBILE CARD-PER-ROW VIEW (<768px) ═══ Same filteredRows/dupMeta as the table - CSS decides which of the two is visible at the current viewport width. */

    function renderMobileCards() {
        const mobileCards = document.getElementById("mobileCards");
        if (displayRows.length === 0) { mobileCards.innerHTML = ""; return; }

        mobileCards.innerHTML = displayRows.map(row => {
            const rowIdx = allRows.indexOf(row);
            const isPk = isTestLead(row);
            const dup = dupMeta[originalRows.indexOf(row)] || {};
            const bigBed = isPk ? null : bedTier(row);
            const rowCls = isPk ? "dup-pk92" : bigBed ? `big-bed ${bigBed}` : dup.email ? "dup-email" : dup.phone ? "dup-phone" : dup.time ? "dup-time" : "";
            const tags = [
                isPk ? `<span class="dup-tag pk92">PK/Test</span>` : "",
                bigBed ? bigBedBadge(bigBed, row) : "",
                ...DUP_TYPES.map(t => dup[t] ? dupTagHtml(row, t, dup.groups[t]) : ""),
            ].join("");
            const rowsHtml = site().mobileFields.filter(c => allColumns.includes(c)).map(c => {
                const dupType = c === "your-email" ? "email" : c === site().phoneCol ? "phone" : null;
                const also = dupType && dup[dupType] ? dupAlsoHtml(row, dup.groups[dupType]) : "";
                return `<div class="m-card-row"><span class="k">${esc(formatCol(c))}</span><span class="v">${formatValue(c, row[c])}${also}</span></div>`;
            }).join("");

            return `<div class="m-card ${rowCls}">
                <div class="m-card-hdr">
                    <span class="m-card-name" data-row="${rowIdx}">${esc(row["your-name"] || row["your-email"] || "(no name)")}</span>
                    <div class="m-card-tags">${tags}</div>
                </div>
                ${rowsHtml}
            </div>`;
        }).join("");
    }

    document.getElementById("mobileCards").addEventListener("click", e => {
        if (openFromDupTag(e)) return;
        const el = e.target.closest(".m-card-name");
        if (!el) return;
        const idx = Number(el.dataset.row);
        const row = allRows[idx];
        if (row) openLeadModal(row);
    });

    /* ═══ LEAD DETAIL MODAL ═══ Click a lead's name → show ALL fields for that lead. */
    const leadModal = document.getElementById("leadModal");
    const leadModalBox = leadModal.querySelector(".modal");
    const leadModalBody = document.getElementById("leadModalBody");
    const leadModalSub = document.getElementById("leadModalSub");

    /* "DUP (3)" buttons in the table and the cards → that lead's details, with its duplicates list highlighted */
    function openFromDupTag(e) {
        const btn = e.target.closest("[data-dup-row]");
        if (!btn) return false;
        const row = allRows[Number(btn.dataset.dupRow)];
        if (row) openLeadModal(row, { flashDups: true });
        return true;
    }

    tableBody.addEventListener("click", function (e) {
        if (openFromDupTag(e)) return;
        const cell = e.target.closest('td[data-col="your-name"]');
        if (!cell) return;
        const idx = Number(cell.dataset.row);
        const row = allRows[idx];
        if (row) openLeadModal(row);
    });

    document.getElementById("leadModalClose").addEventListener("click", closeLeadModal);
    leadModal.addEventListener("click", e => { if (e.target === leadModal) closeLeadModal(); });
    document.addEventListener("keydown", e => {
        if (!leadModal.classList.contains("visible")) return;
        if (e.key === "Escape") closeLeadModal();
        else if (e.key === "ArrowLeft") stepLead(-1);
        else if (e.key === "ArrowRight") stepLead(1);
    });
    document.getElementById("leadModalPrev").addEventListener("click", () => stepLead(-1));
    document.getElementById("leadModalNext").addEventListener("click", () => stepLead(1));
    document.getElementById("leadModalEmptyToggle").addEventListener("click", () => {
        showEmptyFields = !showEmptyFields;
        if (currentLeadRow) openLeadModal(currentLeadRow);
    });

    const leadModalCopy = document.getElementById("leadModalCopy");
    let currentLeadRow = null;

    leadModalCopy.addEventListener("click", () => {
        if (!currentLeadRow) return;
        copyText(leadToText(currentLeadRow)).then(ok => {
            if (!ok) { showToast("Could not copy to clipboard", "error"); return; }
            showToast("Lead details copied. Paste into Teams / Slack", "success");
            leadModalCopy.classList.add("copied");
            leadModalCopy.querySelector("span").textContent = "Copied";
            setTimeout(() => {
                leadModalCopy.classList.remove("copied");
                leadModalCopy.querySelector("span").textContent = "Copy";
            }, 1800);
        });
    });

    // Only these fields are shared, in this order. Matched by display label so
    // "your-name" / "your_name" style keys both resolve.

    // Plain "Label: value" lines (empty fields skipped) - pastes cleanly into Teams and Slack.
    function leadToText(row) {
        const lines = site().copyFields
            .map(label => allColumns.find(c => formatCol(c).toLowerCase() === label.toLowerCase()))
            .filter(Boolean)
            .map(col => [formatCol(col), col === site().phoneCol ? formatPhone(rawValue(col, row)) : rawValue(col, row)])
            .filter(([, v]) => v !== "")
            .map(([k, v]) => `${k}: ${v}`);
        return ["Lead Details", "------------", ...lines].join("\n");
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
        }
        return Promise.resolve(legacyCopy(text));
    }

    // Fallback for non-HTTPS access (e.g. opened via LAN IP), where navigator.clipboard is unavailable.
    function legacyCopy(text) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }

    /* Fields are grouped by what they are about; checked in this order so "page-name" lands in Source, not Contact */
    const LEAD_GROUPS = [["contact", "Contact"], ["org", "Organisation"], ["source", "Source & Campaign"], ["meta", "Submission"]];
    function fieldGroup(col) {
        if (/^utm_|url|page|handl|gclid|matchtype|ref$/i.test(col)) return "source";
        if (/business|bed|speciality|lab|website|company|use-case|employees|minutes|message|text|lead-type/i.test(col)) return "org";
        if (/name|number|phone|email|city|state|country/i.test(col)) return "contact";
        return "meta";
    }
    let showEmptyFields = false;

    /* Gmail compose in a new tab - mailto: does nothing on PCs without a desktop mail app */
    function gmailCompose(to) { return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(String(to).trim())}`; }

    function isEmptyValue(v) { return v == null || v === "" || (Array.isArray(v) && v.length === 0); }

    /* Modal-only value rendering: email / phone / URLs become links, the rest uses the table formatter */
    function leadValueHtml(col, row) {
        const v = row[col];
        if (isEmptyValue(v)) return formatValue(col, v);
        const str = Array.isArray(v) ? v.join(", ") : String(v);
        if (col.includes("email")) return `<a href="${gmailCompose(str)}" target="_blank" rel="noopener" title="Write in Gmail">${esc(str)}</a>`;
        if (col === site().phoneCol) return `<a href="tel:${esc(str.replace(/[^\d+]/g, ""))}">${esc(formatPhone(str))}</a>`;
        if (col === site().bedCol && bedTier(row)) return `<span class="bed-pill ${bedTier(row)}">${esc(str)}</span>`;
        if (col === site().bedCol && isSoftwareAnswer(str)) return `${esc(str)}<span class="soft-tag">Software</span>`;
        if (col === "submit_time") return formatSubmitTime(str) || esc(str);
        if (/^https?:\/\//i.test(str)) {
            /* show host + path only - the query string is just tracking noise (its UTM values are listed separately); full URL stays in href/title */
            const m = str.match(/^https?:\/\/(?:www\.)?([^/?#]+)([^?#]*)([?#].*)?$/i);
            const label = m ? m[1] + (m[2] || "/") + (m[3] ? " …" : "") : str;
            return `<a href="${esc(str)}" target="_blank" rel="noopener" title="${esc(str)}">${esc(label)}</a>`;
        }
        return formatValue(col, v);
    }

    function leadInitials(row) {
        const src = String(row["your-name"] || row["your-email"] || "?").trim();
        const words = src.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/[\s@._-]+/).filter(Boolean);
        return ((words[0] || "?")[0] + (words.length > 1 ? words[1][0] : "")).toUpperCase();
    }

    /* One-click contact actions - WhatsApp needs a country code, so a bare 10-digit number is treated as +91 */
    function leadActionsHtml(row) {
        const phone = String(getPhone(row) || "").trim();
        const digits = phone.replace(/\D/g, "");
        const email = String(row["your-email"] || "").trim();
        const acts = [];
        if (digits.length >= 8) {
            acts.push(`<a class="m-act call" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>Call</a>`);
            acts.push(`<a class="m-act wa" href="https://wa.me/${digits.length === 10 ? "91" + digits : digits}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 01-12.4 7.4L3 21l2.1-5.4A8.5 8.5 0 1121 11.5z"/></svg>WhatsApp</a>`);
        }
        if (email) acts.push(`<a class="m-act mail" href="${gmailCompose(email)}" target="_blank" rel="noopener" title="Write in Gmail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>Email</a>`);
        return acts.join("");
    }

    function leadTagsHtml(row) {
        const isPk = isTestLead(row);
        const dup = dupMeta[originalRows.indexOf(row)] || {};
        const tier = isPk ? null : bedTier(row);
        return [
            tier ? bigBedBadge(tier, row) : "",
            isPk ? `<span class="dup-tag pk92">PK / Test</span>` : "",
            dup.email ? `<span class="dup-tag email">Dup email (${dup.groups.email.length})</span>` : "",
            dup.phone ? `<span class="dup-tag phone">Dup phone (${dup.groups.phone.length})</span>` : "",
            dup.time ? `<span class="dup-tag time">Same time (${dup.groups.time.length})</span>` : "",
            isPk ? "" : `<span class="m-tag">${getAdType(row)}</span>`,
        ].join("");
    }

    function stepLead(dir) {
        const i = displayRows.indexOf(currentLeadRow);
        const next = displayRows[i + dir];
        if (i !== -1 && next) openLeadModal(next);
    }

    /* opts.view "compare" = the lead's duplicates side by side instead of its fields. opts.flashDups = opened from a "DUP (3)" button, so the duplicates list gets a brief highlight. */
    function openLeadModal(row, opts = {}) {
        currentLeadRow = row;
        const tier = isTestLead(row) ? null : bedTier(row);

        const avatar = document.getElementById("leadModalAvatar");
        avatar.textContent = leadInitials(row);
        avatar.className = "modal-hdr-icon" + (tier ? ` bigbed ${tier}` : "");
        document.getElementById("leadModalTitle").textContent = row["your-name"] || row["your-email"] || "Lead";
        /* Subtitle: city + when it came in (email already has its own row and action button) */
        const when = submitTimeParts(row["submit_time"]);
        leadModalSub.textContent = [row["your-city"], when && `${when.abs} (${when.rel})`].filter(Boolean).join("  ·  ") || row["your-email"] || "-";
        document.getElementById("leadModalTags").innerHTML = leadTagsHtml(row);
        document.getElementById("leadModalActions").innerHTML = leadActionsHtml(row);

        /* Prev / next walk the rows exactly as the table currently shows them (filters + sort) */
        const pos = displayRows.indexOf(row);
        const posEl = document.getElementById("leadModalPos");
        /* A duplicate opened from the list can be one the current filters hide - it has no place in the table order */
        posEl.textContent = pos === -1 ? "Filtered out" : `${pos + 1} of ${displayRows.length}`;
        posEl.title = pos === -1 ? "Hidden by the current filters, so ← → are off for this lead" : "";
        document.getElementById("leadModalPrev").disabled = pos <= 0;
        document.getElementById("leadModalNext").disabled = pos === -1 || pos >= displayRows.length - 1;

        const family = dupFamily(row);
        const compare = opts.view === "compare" && family.length > 1;
        leadModalBox.classList.toggle("is-compare", compare);
        /* a column per submission; the table scrolls sideways beyond that */
        leadModalBox.style.maxWidth = compare ? `${Math.min(1180, 200 + family.length * 280)}px` : "";
        leadModalBody.classList.toggle("is-compare", compare);

        const emptyCount = allColumns.filter(c => isEmptyValue(row[c])).length;
        leadModalBody.innerHTML = compare
            ? dupCompareHtml(row, family)
            : (family.length ? dupSectionHtml(row, family, opts.flashDups) : "") + leadFieldsHtml(row);
        leadModalBody.scrollTop = 0;

        const toggle = document.getElementById("leadModalEmptyToggle");
        toggle.hidden = compare || emptyCount === 0;
        toggle.textContent = showEmptyFields ? "Hide empty fields" : `Show ${emptyCount} empty field${emptyCount === 1 ? "" : "s"}`;

        leadModal.classList.add("visible");
    }

    /* The lead's fields in groups: Contact / Organisation / Source & Campaign / Submission */
    function leadFieldsHtml(row) {
        return LEAD_GROUPS.map(([key, title]) => {
            let cols = allColumns.filter(c => fieldGroup(c) === key);
            if (key === "meta") cols = [...cols.filter(c => c === "submit_time"), ...cols.filter(c => c !== "submit_time")];
            const shown = cols.filter(c => showEmptyFields || !isEmptyValue(row[c]));
            if (!shown.length) return "";
            return `<section class="lead-sec">
                <h4>${title}</h4>
                ${shown.map(col => `
                <div class="lead-field${isEmptyValue(row[col]) ? " is-empty" : ""}">
                    <div class="lead-field-label">${esc(formatCol(col))}</div>
                    <div class="lead-field-value">${leadValueHtml(col, row)}</div>
                </div>`).join("")}
            </section>`;
        }).join("");
    }

    function closeLeadModal() {
        leadModal.classList.remove("visible");
    }

    /* ═══ DUPLICATES IN THE LEAD MODAL ═══ Every submission sharing this lead's email, phone or exact submit time in the selected dates, oldest first: when it came in, what matches, a button to open each one and a side-by-side comparison of all of them. */
    function dupSectionHtml(row, family, flash) {
        const items = family.map((r, i) => {
            const isCur = r === row;
            const p = submitTimeParts(r["submit_time"]);
            const page = getPageName(r);
            const matches = isCur ? "" : DUP_TYPES.filter(t => dupGroup(row, t).includes(r))
                .map(t => `<span class="dup-match ${t}">${DUP_MATCH_LABEL[t]}</span>`).join("");
            return `<li class="dup-item${isCur ? " is-current" : ""}">
                <span class="dup-ord">${i + 1}</span>
                <div class="dup-main">
                    <div class="dup-when"><strong>${esc(p ? p.abs : r["submit_time"] || "Unknown time")}</strong>${p ? `<span>${esc(p.rel)}</span>` : ""}</div>
                    <div class="dup-sub">${esc(r["your-name"] || r["your-email"] || "(no name)")}${page === "(unknown)" ? "" : ` · ${esc(page)}`}</div>
                </div>
                <div class="dup-matches">${matches}</div>
                ${isCur ? `<span class="dup-viewing">Viewing</span>` : `<button type="button" class="dup-open" data-open-row="${allRows.indexOf(r)}">Open</button>`}
            </li>`;
        }).join("");
        return `<section class="dup-sec${flash ? " flash" : ""}" id="leadDupSec">
            <div class="dup-sec-hdr">
                <h4>Duplicates (${family.length})</h4>
                <span class="dup-sec-note">Same email, phone or submit time in the selected dates</span>
                <button type="button" class="dup-compare-btn" data-dup-act="compare">Compare side by side</button>
            </div>
            <ol class="dup-list">${items}</ol>
        </section>`;
    }

    /* Side by side: a column per submission (oldest first), a row per field. Rows where the submissions disagree are flagged; cells that differ from the lead you opened are tinted. */
    let dupDiffOnly = false;
    function dupCompareHtml(row, family) {
        let diffCount = 0;
        const body = LEAD_GROUPS.map(([key, title]) => {
            let cols = allColumns.filter(c => fieldGroup(c) === key);
            if (key === "meta") cols = [...cols.filter(c => c === "submit_time"), ...cols.filter(c => c !== "submit_time")];
            const rowsHtml = cols.map(col => {
                if (family.every(r => isEmptyValue(r[col]))) return "";
                const keys = family.map(r => compareKey(col, r));
                const differs = new Set(keys).size > 1;
                if (differs) diffCount++;
                if (dupDiffOnly && !differs) return "";
                const curKey = compareKey(col, row);
                const cells = family.map((r, i) => {
                    const cls = [r === row ? "is-current" : "", differs && keys[i] !== curKey ? "differs" : ""].filter(Boolean).join(" ");
                    return `<td${cls ? ` class="${cls}"` : ""}>${leadValueHtml(col, r)}</td>`;
                }).join("");
                return `<tr${differs ? ` class="is-diff"` : ""}><th scope="row">${esc(formatCol(col))}</th>${cells}</tr>`;
            }).join("");
            return rowsHtml ? `<tr class="cmp-grp"><th colspan="${family.length + 1}"><span>${title}</span></th></tr>${rowsHtml}` : "";
        }).join("");
        const head = family.map((r, i) => {
            const isCur = r === row;
            const p = submitTimeParts(r["submit_time"]);
            return `<th${isCur ? ` class="is-current"` : ""}><div class="cmp-col">
                <span class="dup-ord">${i + 1}</span>
                <span class="cmp-when">${esc(p ? p.short : r["submit_time"] || "Unknown time")}</span>
                ${isCur ? `<span class="dup-viewing">Viewing</span>` : `<button type="button" class="dup-open" data-open-row="${allRows.indexOf(r)}">Open</button>`}
            </div></th>`;
        }).join("");
        return `<div class="cmp-bar">
                <button type="button" class="cmp-back" data-dup-act="back">‹ Back to details</button>
                <span class="cmp-summary">${family.length} submissions · <b>${diffCount} field${diffCount === 1 ? " differs" : "s differ"}</b></span>
                <label class="cmp-diff-only"><input type="checkbox" data-dup-act="diff-only"${dupDiffOnly ? " checked" : ""}> Only differences</label>
            </div>
            <div class="cmp-scroll"><table class="cmp-table">
                <thead><tr><th>Field</th>${head}</tr></thead>
                <tbody>${body || `<tr><td colspan="${family.length + 1}" class="cmp-none">No differences - every field matches.</td></tr>`}</tbody>
            </table></div>`;
    }
    /* "Same value" for the comparison: case and spacing ignored, phone numbers by digits (+91 / 0 prefixes folded, like the dup check) */
    function compareKey(col, row) {
        const v = rawValue(col, row).trim().toLowerCase();
        return col === site().phoneCol ? (phoneKey(v) ?? v) : v;
    }

    /* Duplicates list / compare view: open another submission, switch views, "Only differences" */
    leadModalBody.addEventListener("click", e => {
        const open = e.target.closest("[data-open-row]");
        if (open) {
            const r = allRows[Number(open.dataset.openRow)];
            if (r) openLeadModal(r);
            return;
        }
        const act = e.target.closest("button[data-dup-act]");
        if (act && currentLeadRow) openLeadModal(currentLeadRow, act.dataset.dupAct === "compare" ? { view: "compare" } : {});
    });
    leadModalBody.addEventListener("change", e => {
        if (!e.target.matches('input[data-dup-act="diff-only"]') || !currentLeadRow) return;
        dupDiffOnly = e.target.checked;
        openLeadModal(currentLeadRow, { view: "compare" });
    });

    /* ═══ EXPORT ═══ */
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
        const cols = site().pk92ExportCols.filter(c => allColumns.includes(c));
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

    /* ═══ HELPERS ═══ */
    function formatCol(col) {
        const label = site().colLabels?.[col];
        if (label) return label;
        return col.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatValue(col, value) {

        if (value === null || value === undefined || value === "")
            return '<span class="cell-empty">-</span>';
        if (col.startsWith("utm_")) {
            const resolved = extractUtmVal(value, col);
            /* Only the campaign gets a badge - source/medium as plain text so the row has one focal point */
            return col === "utm_campaign"
                ? `<span class="badge">${esc(resolved || value)}</span>`
                : `<span class="utm-plain">${esc(resolved || value)}</span>`;
        }
        if (Array.isArray(value)) return esc(value.join(", "));

        return esc(String(value));
    }

    /* Table-only presentation (the modal keeps full values via formatValue): URLs drop the scheme + host so the useful part - the page path - is what shows before the ellipsis. */
    function formatCell(col, value) {
        if (col === "your-name" && (value == null || String(value).trim() === "")) return `<span class="nm nm-empty">View</span>`;
        if (value === null || value === undefined || value === "") return formatValue(col, value);
        if (col === "your-name") return `<span class="nm">${esc(String(value).trim())}</span>`;
        if (col === "submit_time") {
            const html = formatSubmitTime(value);
            if (html) return html;
        }
        if (col === site().phoneCol) return esc(formatPhone(value));
        if (tdClass(col) === "cell-url" && !Array.isArray(value)) {
            const m = String(value).match(/^https?:\/\/(?:www\.)?([^/?#]+)(.*)$/i);
            if (m) return `<span class="url-path">${esc(m[2] || "/")}</span>`;
        }
        return formatValue(col, value);
    }

    /* Submit Time - exact time to the second, with the day said plainly ("Today" / "Yesterday" / "31 Oct") and how long ago it was underneath. submit_time is the site's local (IST) wall-clock time, read as-is - no timezone shifting. */
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function parseSubmitTime(value) {
        const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    }
    function submitTimeParts(value) {
        const d = parseSubmitTime(value);
        if (!d) return null;
        const now = new Date();
        const dayStart = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const dayDiff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
        const pad = n => String(n).padStart(2, "0");
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const day = dayDiff === 0 ? "Today"
            : dayDiff === 1 ? "Yesterday"
            : `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
        return { abs: `${day}, ${time}`, short: `${day} ${time.slice(0, 5)}`, rel: relativeTime(d.getTime()), ts: d.getTime() };
    }
    function formatSubmitTime(value) {
        const p = submitTimeParts(value);
        return p ? `<span class="st-abs">${p.abs}</span><span class="st-rel" data-ts="${p.ts}">${p.rel}</span>` : null;
    }
    function relativeTime(ts) {
        const mins = Math.floor((Date.now() - ts) / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins} min ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs} hr ${mins % 60} min ago`;
        const days = Math.floor(hrs / 24);
        return days === 1 ? `1 day ${hrs % 24} hr ago` : `${days} days ago`;
    }
    /* Keep "x min ago" honest while the page stays open */
    setInterval(() => {
        document.querySelectorAll(".st-rel[data-ts]").forEach(el => { el.textContent = relativeTime(+el.dataset.ts); });
        updateLastUpdated();
    }, 30000);

    /* Indian numbers arrive both as "+917907789041" and "+91 9365981730" - show them one way everywhere */
    function formatPhone(value) {
        const str = String(value ?? "").trim();
        const d = str.replace(/\D/g, "");
        return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2)}` : str;
    }

    /* Bed-size field also collects billing-software answers ("Marg") - true for those */
    function isSoftwareAnswer(v) {
        v = String(v || "").trim();
        return !!v && !/bed|clinic|opd|group/i.test(v);
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
        const pkShown = displayRows.length - filteredRows.length;
        document.getElementById("paginationInfo").textContent =
            (filteredRows.length === originalRows.length
                ? `Showing all ${originalRows.length} rows`
                : `Showing ${filteredRows.length} of ${originalRows.length} rows`) +
            (pkShown > 0 ? ` + ${pkShown} Pakistan/Test (highlighted, not counted)` : "");
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
