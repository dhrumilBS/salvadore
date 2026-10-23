/*
 * Tool usage report, live. data.php gives the sessions once; live.php is then
 * polled every POLL ms for only the log lines written since, which
 * applyEntry() folds in (the same rules data.php uses). Rows that appear flash,
 * the Live now timers tick every second, and the whole log is re-checked in
 * full every FULL_CHECK ms. Polling pauses while this tab is hidden.
 *
 * Charts are plain SVG/HTML, one hue (--series, validated for both themes):
 * activity over time (columns), top tools (bars), weekday × hour (heatmap).
 * All three follow the filters and the Active time / Visits / People switch.
 */
(() => {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const RELOAD_GAP = 10;      // s: reopening the same page this soon counts as the same visit
    const LIVE_WINDOW = 45;     // s: a tab that reported within this long is "live" (it reports every 15 s)
    const ACTIVE_WINDOW = 40;   // s: live and its active time went up within this long = "Active", else "Idle"
    const POLL = 2000, FULL_CHECK = 5 * 60e3;
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let data = null, sessions = new Map(), cursor = null, range = 'today', metric = 'active', tab = 'people', shown = 200;
    let skew = 0, lastOk = 0, failures = 0, dirty = false, pollTimer = null, loading = null, chartKey = '';
    const seen = new Set();
    let firstRender = true;

    // ── formatting ──

    const now = () => Date.now() / 1000 + skew;
    const dur = s => {
        if (!s) return '0m';
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
        return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m` : `${Math.round(s)}s`;
    };
    const clock = s => {
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
        return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(sec).padStart(2, '0');
    };
    const when = t => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const ago = t => {
        const s = now() - t;
        return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
    };
    const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
    const net = ip => {
        if (ip === '127.0.0.1' || ip === '::1' || ip === data.serverIp) return 'This PC';
        if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return 'Office LAN';
        return 'Internet';
    };
    const device = ua => {
        const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
        const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
        return ua ? `${b}${o ? ' · ' + o : ''}` : '—';
    };
    // A person is a browser (device ID) when known, else an IP. A device without
    // its own name borrows the name given to the IP it was last seen on.
    const lastIp = new Map(), lastIpAt = new Map();
    const name = key => data.labels[key] || (key.startsWith('d:') ? (data.labels[lastIp.get(key)] || lastIp.get(key)) : key);
    const initials = n => {
        if (n === '::1' || n === '127.0.0.1') return 'PC';
        if (/^[\d.]+$/.test(n)) return '.' + n.split('.').pop();
        const w = n.trim().split(/\s+/);
        return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : (w[0]?.[1] || ''))).toUpperCase();
    };
    const avatar = (key, live, sm) => `<span class="av${sm ? ' sm' : ''}" aria-hidden="true">${esc(initials(name(key)))}${live ? '<i class="on"></i>' : ''}</span>`;
    const netCell = ip => {
        const n = net(ip);
        const cls = n === 'Internet' ? 'ext' : n === 'This PC' ? 'me' : 'lan';
        const link = n === 'Internet' ? ` <a href="https://ipinfo.io/${encodeURIComponent(ip)}" target="_blank" rel="noopener noreferrer" title="Look up where this IP is">where?</a>` : '';
        return `<span class="net ${cls}">${n}</span>${link}`;
    };
    const time = (s, v) => s.past ? '<span class="dim" title="From Apache\'s log - no time data before tracking started">—</span>' : dur(v);
    const pageOf = s => s.path.replace(/^\/salvadore\//, '') + (s.tabs.length ? ' ' + s.tabs.join(' ') : '');
    const METRICS = {
        active: { label: 'Active time', of: list => list.reduce((a, s) => a + s.active, 0), fmt: dur },
        visits: { label: 'Visits', of: list => list.length, fmt: v => v.toLocaleString() },
        people: { label: 'People', of: list => new Set(list.map(s => s.who)).size, fmt: v => v.toLocaleString() },
    };
    const ICONS = {
        live: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
        people: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
        visits: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/></svg>',
        active: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
        open: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        top: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>',
    };

    function since() {
        if (range === 'all') return 0;
        if (range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d / 1000); }
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (range - 1));
        return Math.floor(d / 1000);
    }

    // ── data ──

    // IP -> device IDs seen on it. Visits without a device ID (history, or before
    // the tracker had one) go to that browser when the IP only ever had one.
    const ipDevs = new Map();
    function remember(s) {
        s.net = net(s.ip);
        if (s.dev) {
            if (!ipDevs.has(s.ip)) ipDevs.set(s.ip, new Set());
            ipDevs.get(s.ip).add(s.dev);
        }
        s.who = s.dev ? 'd:' + s.dev : s.ip;
        if (s.dev && s.start >= (lastIpAt.get(s.who) ?? -1)) {
            lastIp.set(s.who, s.ip);
            lastIpAt.set(s.who, s.start);
        }
    }
    function attribute() {
        sessions.forEach(s => {
            const devs = ipDevs.get(s.ip);
            s.who = s.dev ? 'd:' + s.dev : devs?.size === 1 ? 'd:' + [...devs][0] : s.ip;
        });
    }

    /** Folds one new log entry into its session - the same rules as data.php. */
    function applyEntry(e) {
        const key = e.ip + '|' + e.sid;
        let s = sessions.get(key);
        if (!s) {
            s = { key, ip: e.ip, start: e.t, end: e.t, path: e.path, tabs: [], open: 0, active: 0, activeAt: 0, ua: '', dev: '', title: '', ref: '', fwd: '', closed: false, past: e.ev === 'past', tool: e.tool };
            sessions.set(key, s);
        }
        s.start = Math.min(s.start, e.t);
        s.end = Math.max(s.end, e.t);
        s.open = Math.max(s.open, e.open || 0);
        if ((e.active || 0) > s.active) { s.active = e.active; s.activeAt = e.t; }
        if (e.ev === 'start' || e.ev === 'past') {
            ['path', 'ua', 'dev', 'title', 'ref', 'fwd', 'tool'].forEach(k => { if (e[k] !== undefined) s[k] = e[k]; });
        }
        if (e.tab && !s.tabs.includes(e.tab)) s.tabs.push(e.tab);
        if (e.ev === 'end') s.closed = true;
        remember(s);
    }

    /** Visits: sessions with a page reopened within RELOAD_GAP seconds folded into the one before. */
    function visits() {
        const prev = new Map(), out = [];
        [...sessions.values()].sort((a, b) => a.start - b.start).forEach(raw => {
            const s = { ...raw, tabs: [...raw.tabs], reloads: 0 };
            const k = `${s.who}|${s.path}|${s.past}`;
            const p = prev.get(k);
            if (p && s.start - p.end <= RELOAD_GAP) {
                p.end = Math.max(p.end, s.end);
                p.open += s.open;
                p.active += s.active;
                p.activeAt = Math.max(p.activeAt, s.activeAt);
                p.reloads++;
                p.closed = s.closed;
                s.tabs.forEach(t => p.tabs.includes(t) || p.tabs.push(t));
                return;
            }
            prev.set(k, s);
            out.push(s);
        });
        return out.sort((a, b) => b.start - a.start);
    }

    async function load() {
        if (loading) return loading;
        $('main').classList.add('loading');
        loading = (async () => {
            const res = await fetch('data.php?since=' + since(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            data = await res.json();
            skew = data.now - Date.now() / 1000;
            sessions = new Map();
            lastIp.clear();
            lastIpAt.clear();
            ipDevs.clear();
            data.sessions.forEach(s => { sessions.set(s.key, s); remember(s); });
            attribute();
            cursor = data.integrity.cursor;
            lastOk = Date.now();
            failures = 0;
            chartKey = '';
            fillFilters();
            render();
        })().finally(() => { loading = null; $('main').classList.remove('loading'); });
        return loading;
    }

    async function poll() {
        clearTimeout(pollTimer);
        if (document.hidden) return status();
        try {
            if (!data) {
                await load();
            } else {
                const res = await fetch('live.php?' + new URLSearchParams(cursor), { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const r = await res.json();
                skew = r.now - Date.now() / 1000;
                if (!r.ok) {
                    await load(); // the log changed under us - full reload shows exactly where
                } else {
                    cursor = r.cursor;
                    if (r.entries.length) {
                        const newPeople = r.entries.some(e => !sessions.has(e.ip + '|' + e.sid));
                        r.entries.forEach(applyEntry);
                        data.integrity.entries += r.entries.length;
                        if (newPeople) { attribute(); fillFilters(); }
                        dirty = true;
                    }
                }
                lastOk = Date.now();
                failures = 0;
            }
        } catch (err) {
            failures++;
        }
        status();
        if (dirty) { dirty = false; render(); }
        // Back off while the server doesn't answer: 2 s, 4 s, 8 s … up to 30 s.
        pollTimer = setTimeout(poll, failures ? Math.min(30e3, POLL * 2 ** failures) : POLL);
    }

    // ── view helpers ──

    function status() {
        const el = $('status'), label = el.querySelector('span');
        if (document.hidden) {
            el.className = 'status';
            label.textContent = 'Paused';
        } else if (failures) {
            el.className = 'status error';
            label.textContent = 'Reconnecting…';
        } else if (lastOk) {
            el.className = 'status live';
            const s = Math.round((Date.now() - lastOk) / 1000);
            label.textContent = 'Live';
            el.title = s < 2 ? 'Up to date' : `Updated ${s}s ago`;
        }
    }

    function fillFilters() {
        const keep = (sel, values, label) => {
            const cur = sel.value;
            sel.innerHTML = `<option value="">${label}</option>` + values.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
            sel.value = values.some(([v]) => v === cur) ? cur : '';
        };
        const all = [...sessions.values()];
        const people = [...new Set(all.map(s => s.who))].sort((a, b) => name(a).localeCompare(name(b)));
        keep($('fPerson'), people.map(k => [k, name(k) + (k.startsWith('d:') ? ` · device ${k.slice(2, 6)}` : '')]), 'Everyone');
        keep($('fTool'), [...new Set(all.map(s => s.tool))].sort().map(t => [t, t]), 'All tools');
    }

    function group(rows, key) {
        const m = new Map();
        rows.forEach(s => {
            const k = key(s);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(s);
        });
        return [...m].map(([k, list]) => ({
            k, list,
            active: list.reduce((a, s) => a + s.active, 0),
            open: list.reduce((a, s) => a + s.open, 0),
            last: Math.max(...list.map(s => s.end)),
        })).sort((a, b) => b.active - a.active || b.list.length - a.list.length || b.last - a.last);
    }
    const top = (list, key, n = 3) => group(list, key).slice(0, n).map(g => `${esc(g.k)} <span class="dim">${g.list.every(s => s.past) ? g.list.length + '×' : dur(g.active)}</span>`).join(', ');
    const isLive = s => !s.past && !s.closed && now() - s.end <= LIVE_WINDOW;
    const isActive = s => now() - Math.max(s.activeAt, s.active ? 0 : s.start) <= ACTIVE_WINDOW;
    const fresh = key => { const n = !firstRender && !seen.has(key); seen.add(key); return n; };
    const share = (v, max) => `<span class="share">${dur(v)}<i style="--w:${max ? Math.max(2, Math.round(v / max * 100)) : 0}%"></i></span>`;

    // ── tooltip ──

    const tip = $('tip');
    function showTip(e, html) {
        tip.innerHTML = html;
        tip.hidden = false;
        const r = tip.getBoundingClientRect();
        const x = e.clientX + 14 + r.width > innerWidth ? e.clientX - r.width - 14 : e.clientX + 14;
        const y = e.clientY + 14 + r.height > innerHeight ? e.clientY - r.height - 10 : e.clientY + 14;
        tip.style.left = Math.max(8, x) + 'px';
        tip.style.top = Math.max(8, y) + 'px';
    }
    const hideTip = () => { tip.hidden = true; };
    const tipBody = (title, list) => `<div class="t">${esc(title)}</div>`
        + ['active', 'visits', 'people'].map(m => `<div class="r"><span>${m === metric ? '<i class="k"></i>' : ''}${METRICS[m].label}</span><b>${METRICS[m].fmt(METRICS[m].of(list))}</b></div>`).join('');

    // ── charts ──

    /** Time buckets for the activity chart: hours for Today, days up to ~4 months, then weeks. */
    function buckets(rows) {
        const out = [];
        if (range === 'today') {
            const d0 = since();
            for (let h = 0; h < 24; h++) out.push({ start: d0 + h * 3600, end: d0 + (h + 1) * 3600, short: String(h).padStart(2, '0'), long: `Today ${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00` });
            return out;
        }
        const first = range === 'all' ? Math.min(now(), ...rows.map(s => s.start)) : since();
        const d = new Date(first * 1000); d.setHours(0, 0, 0, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const days = Math.round((today - d) / 864e5) + 1;
        const step = days > 120 ? 7 : 1;
        for (let i = 0; i < days; i += step) {
            const a = new Date(d); a.setDate(d.getDate() + i);
            const b = new Date(d); b.setDate(d.getDate() + i + step);
            const lbl = a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            out.push({ start: a / 1000, end: b / 1000, short: lbl, long: step > 1 ? `Week of ${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : a.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) });
        }
        return out;
    }

    /** Round axis maximum + step: whole minutes/hours for time, 1-2-5 steps for counts. */
    function niceScale(max) {
        const steps = metric === 'active'
            ? [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]
            : [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
        const step = steps.find(s => s * 4 >= max) || steps[steps.length - 1];
        return { step, max: Math.max(step, Math.ceil(max / step) * step) };
    }

    function activityChart(rows) {
        const box = $('activity'), M = METRICS[metric];
        const bs = buckets(rows);
        bs.forEach(b => { b.list = []; });
        rows.forEach(s => {
            let lo = 0, hi = bs.length - 1;
            if (!bs.length || s.start < bs[0].start || s.start >= bs[hi].end) return;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bs[mid].start <= s.start) lo = mid; else hi = mid - 1; }
            bs[lo].list.push(s);
        });
        bs.forEach(b => { b.v = M.of(b.list); });
        const total = metric === 'people' ? M.of(rows) : bs.reduce((a, b) => a + b.v, 0);
        $('activityTitle').textContent = `${M.label} ${range === 'today' ? 'by hour' : bs.length && bs[1] && bs[1].start - bs[0].start > 86400 ? 'by week' : 'by day'}`;
        $('activitySub').textContent = `${M.fmt(total)} in total` + (metric === 'active' && rows.some(s => s.past) ? ' · history rows have no time data' : '');

        const maxV = Math.max(0, ...bs.map(b => b.v));
        if (!maxV) {
            box.innerHTML = `<div class="empty-chart">No ${M.label.toLowerCase()} in this range yet.<br>It fills in live as people use the tools.</div>`;
            return;
        }
        const W = box.clientWidth || 600, H = box.clientHeight || 240;
        const L = 46, R = 8, T = 22, B = 24, pw = W - L - R, ph = H - T - B;
        const { step, max } = niceScale(maxV);
        const band = pw / bs.length, cw = Math.max(2, Math.min(24, band * 0.72));
        const y = v => T + ph - v / max * ph;
        let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.label)} over time"><g class="grid">`;
        for (let v = step; v <= max; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        svg += '</g>';
        for (let v = 0; v <= max; v += step) svg += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(M.fmt(v))}</text>`;
        const every = Math.ceil(44 / band);
        const peak = bs.reduce((a, b, i) => b.v > bs[a].v ? i : a, 0);
        bs.forEach((b, i) => {
            const x = L + i * band, cx = x + (band - cw) / 2;
            const h = b.v / max * ph, r = Math.min(4, h, cw / 2);
            svg += `<rect class="hit" data-i="${i}" x="${x}" y="${T}" width="${band}" height="${ph}"/>`;
            if (h > 0) svg += `<path class="col" data-i="${i}" d="M${cx},${T + ph} V${T + ph - h + r} Q${cx},${T + ph - h} ${cx + r},${T + ph - h} H${cx + cw - r} Q${cx + cw},${T + ph - h} ${cx + cw},${T + ph - h + r} V${T + ph} Z"/>`;
            if (i % every === 0) svg += `<text x="${x + band / 2}" y="${H - 6}" text-anchor="middle">${esc(b.short)}</text>`;
        });
        const pb = bs[peak], px = L + peak * band + band / 2;
        svg += `<text class="peak" x="${Math.min(W - R - 20, Math.max(L + 20, px))}" y="${y(pb.v) - 7}" text-anchor="middle">${esc(M.fmt(pb.v))}</text>`;
        svg += `<line class="baseline" x1="${L}" x2="${W - R}" y1="${T + ph + .5}" y2="${T + ph + .5}"/></svg>`;
        box.innerHTML = svg;
        box.onpointermove = e => {
            const i = e.target.dataset?.i;
            box.querySelectorAll('.col.hover').forEach(c => c.classList.remove('hover'));
            if (i === undefined) return hideTip();
            box.querySelector(`.col[data-i="${i}"]`)?.classList.add('hover');
            const b = bs[i];
            showTip(e, tipBody(b.long, b.list) + (b.list.length ? `<div class="r" style="margin-top:6px"><span>Top tool</span><b>${esc(group(b.list, s => s.tool)[0].k)}</b></div>` : ''));
        };
        box.onpointerleave = () => { hideTip(); box.querySelectorAll('.col.hover').forEach(c => c.classList.remove('hover')); };
    }

    function toolChart(rows) {
        const box = $('toolChart'), M = METRICS[metric];
        let g = group(rows, s => s.tool).map(t => ({ ...t, v: M.of(t.list) })).filter(t => t.v > 0).sort((a, b) => b.v - a.v);
        if (g.length > 8) {
            const rest = g.slice(7), list = rest.flatMap(t => t.list);
            g = [...g.slice(0, 7), { k: `Other (${rest.length})`, list, v: M.of(list), other: true }];
        }
        $('toolSub').textContent = `By ${M.label.toLowerCase()} · click a tool to filter`;
        if (!g.length) {
            box.innerHTML = `<div class="empty-chart" style="height:200px">No ${M.label.toLowerCase()} in this range yet.</div>`;
            return;
        }
        const max = g[0].v, cur = $('fTool').value;
        box.innerHTML = g.map((t, i) => `<button type="button" class="bar-row${cur === t.k ? ' on' : ''}" data-i="${i}" ${t.other ? 'disabled' : ''}>
            <span class="lbl" title="${esc(t.k)}">${esc(t.k)}${t.list.some(isLive) ? '<i class="live-dot" title="In use right now"></i>' : ''}</span>
            <span class="track"><span class="fill" style="width:${Math.max(1, t.v / max * 100)}%"></span></span>
            <span class="val">${esc(M.fmt(t.v))}</span></button>`).join('');
        box.onpointermove = e => {
            const row = e.target.closest('.bar-row');
            if (!row) return hideTip();
            const t = g[row.dataset.i];
            showTip(e, tipBody(t.k, t.list) + `<div class="r" style="margin-top:6px"><span>Most by</span><b>${esc(name(group(t.list, s => s.who)[0].k))}</b></div>`);
        };
        box.onpointerleave = hideTip;
        box.onclick = e => {
            const row = e.target.closest('.bar-row');
            if (!row || row.disabled) return;
            const t = g[row.dataset.i].k;
            $('fTool').value = $('fTool').value === t ? '' : t;
            onFilter();
        };
    }

    function heatmap(rows) {
        const box = $('heatmap'), M = METRICS[metric];
        const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
        rows.forEach(s => { const d = new Date(s.start * 1000); cells[(d.getDay() + 6) % 7][d.getHours()].push(s); });
        const vals = cells.map(r => r.map(list => M.of(list)));
        const max = Math.max(0, ...vals.flat());
        const today = (new Date().getDay() + 6) % 7;
        $('heatSub').textContent = `${M.label} by weekday and hour` + (range === 'today' ? ' · only today so far — pick 7 or 30 days to see the pattern' : '');
        let html = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="hl">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('');
        vals.forEach((r, d) => {
            html += `<span class="dl">${DAYS[d]}</span>`;
            r.forEach((v, h) => {
                // One hue, light→dark: share of the busiest hour, mixed into the empty-cell color.
                const p = max && v ? Math.round(18 + 82 * Math.sqrt(v / max)) : 0;
                html += `<span class="cell${d === today ? ' today' : ''}" data-d="${d}" data-h="${h}"${p ? ` style="background:color-mix(in oklab, var(--series) ${p}%, var(--surface2))"` : ''}></span>`;
            });
        });
        box.innerHTML = html;
        box.onpointermove = e => {
            const c = e.target.closest('.cell');
            if (!c) return hideTip();
            const d = +c.dataset.d, h = +c.dataset.h;
            showTip(e, tipBody(`${DAYS[d]} ${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00`, cells[d][h]));
        };
        box.onpointerleave = hideTip;
    }

    // ── render ──

    function integrity() {
        const i = data.integrity, el = $('integrity'), b = i.backup;
        el.className = 'pill ' + (i.ok ? 'ok' : 'bad');
        if (i.broken) {
            el.textContent = `✗ Log was edited or lines deleted — first bad line: ${i.broken.file} line ${i.broken.line}`;
        } else if (b && !b.matches) {
            el.textContent = `✗ Entries missing — the backup from ${when(b.t)} had ${b.entries.toLocaleString()}, the log now has ${i.entries.toLocaleString()}`;
        } else {
            el.textContent = `✓ Log intact · ${i.entries.toLocaleString()} entries`;
        }
        el.title = [
            i.broken ? 'Lines from here on no longer match their signatures.' : 'Every line\'s signature checks out. New lines are checked as they arrive; the whole log every 5 minutes.',
            b ? `Last backup: ${new Date(b.t * 1000).toLocaleString()} (${b.entries.toLocaleString()} entries)${b.matches ? ' - still matches.' : ' - the log no longer contains it.'}` : 'No backup yet - see the Task Scheduler task "Salvadore usage backup".',
        ].join('\n');
    }

    function setTiles(tiles) {
        const box = $('tiles');
        if (box.children.length !== tiles.length) {
            box.innerHTML = tiles.map(t => `<div class="tile ${t.cls || ''}"><span class="label"><span class="ico">${ICONS[t.icon]}</span>${t.label}</span><b></b><small></small></div>`).join('');
        }
        tiles.forEach((t, i) => {
            const el = box.children[i], b = el.querySelector('b');
            if (b.innerHTML !== String(t.value)) {
                if (!firstRender) { b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 900); }
                b.innerHTML = t.value;
            }
            el.querySelector('small').textContent = t.sub;
            el.title = t.sub;
        });
    }

    function render() {
        integrity();
        const fp = $('fPerson').value, ft = $('fTool').value, fn = $('fNet').value;
        ['fPerson', 'fTool', 'fNet'].forEach(id => $(id).classList.toggle('on', !!$(id).value));
        $('clear').hidden = !(fp || ft || fn);
        const match = s => (!fp || s.who === fp) && (!ft || s.tool === ft) && (!fn || s.net === fn);
        const rows = visits().filter(match);
        const people = group(rows, s => s.who), tools = group(rows, s => s.tool);
        const live = [...sessions.values()].filter(s => isLive(s) && match(s)).sort((a, b) => a.start - b.start);
        const tracked = rows.filter(s => !s.past);
        const active = tracked.reduce((a, s) => a + s.active, 0), open = tracked.reduce((a, s) => a + s.open, 0);
        const activeNow = live.filter(isActive).length;
        const outside = new Set(rows.filter(s => s.net === 'Internet').map(s => s.who)).size;

        setTiles([
            { icon: 'live', cls: 'live-tile', label: 'Live now', value: live.length, sub: live.length ? `${activeNow} active · ${live.length - activeNow} idle` : 'Nobody right now' },
            { icon: 'people', label: 'People', value: people.length, sub: outside ? `${outside} from outside the office` : 'All on the office network' },
            { icon: 'visits', label: 'Visits', value: rows.length.toLocaleString(), sub: people.length ? `${(rows.length / people.length).toFixed(1)} per person` : '—' },
            { icon: 'active', label: 'Active time', value: dur(active), sub: tracked.length ? `${dur(Math.round(active / tracked.length))} per visit` : 'No tracked visits yet' },
            { icon: 'open', label: 'Open time', value: dur(open), sub: open ? `${Math.round(active / open * 100)}% of it actively used` : '—' },
            { icon: 'top', label: 'Most used', value: tools[0] ? esc(tools[0].k) : '—', sub: tools[0] ? `${dur(tools[0].active)} · ${plural(new Set(tools[0].list.map(s => s.who)).size, 'person').replace('persons', 'people')}` : '—' },
        ]);

        // Live now cards
        $('liveCount').textContent = live.length;
        $('live').innerHTML = live.length ? live.map(s => {
            const act = isActive(s);
            return `<div class="live-card${act ? '' : ' idle'}${fresh('live|' + s.key) ? ' new' : ''}">
                ${avatar(s.who, true)}
                <span class="who" title="${esc(s.ip)}">${esc(name(s.who))}</span>
                <span class="state ${act ? 'active' : 'idle'}" title="${act ? 'Clicking, typing or scrolling in the last minute' : 'Tab open and visible, but no input lately'}">${act ? 'Active' : 'Idle'}</span>
                <span class="sub" title="${esc(s.title)}"><b>${esc(s.tool)}</b> · ${esc(pageOf(s))}</span>
                <div class="meta"><span class="clock" data-since="${s.start}" title="Time on this page">${clock(now() - s.start)}</span>
                    <span>${dur(s.active)} active · ${netCell(s.ip)} · ${esc(device(s.ua))}</span></div>
            </div>`;
        }).join('') : '<div class="live-empty">Nobody has a tool open right now — people show up here the moment they open one.</div>';

        // Charts: only rebuilt when what they show changed (keeps hover steady between live ticks).
        const key = [range, metric, fp, ft, fn, rows.length, active, rows[0]?.key, rows[0]?.end, live.length, $('activity').clientWidth].join('|');
        if (key !== chartKey) {
            chartKey = key;
            activityChart(rows);
            toolChart(rows);
            heatmap(rows);
        }

        // Tables
        $('nPeople').textContent = people.length;
        $('nTools').textContent = tools.length;
        $('nVisits').textContent = rows.length.toLocaleString();
        const empty = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
        const none = data.integrity.entries ? 'Nothing in this range yet — new visits appear here as they happen.' : 'No visits recorded yet — they appear here as soon as someone opens a tool.';
        const maxP = Math.max(0, ...people.map(p => p.active)), maxT = Math.max(0, ...tools.map(t => t.active));

        $('people').innerHTML = `<thead><tr><th>Who</th><th>Where</th><th>Device</th><th class="num">Visits</th><th class="num">Active</th><th class="num">Open</th><th>Last seen</th><th>Top tools</th></tr></thead><tbody>${people.length ? people.map(p => {
            const latest = p.list.reduce((a, s) => s.start > a.start ? s : a);
            const ips = [...new Set(p.list.map(s => s.ip))];
            const sub = [p.k.startsWith('d:') ? `device ${p.k.slice(2, 6)}` : '', ips.join(', ')].filter(Boolean).join(' · ');
            const on = p.list.some(isLive);
            return `<tr${fresh('p|' + p.k) ? ' class="new"' : ''}><td><div class="person">${avatar(p.k, on, true)}<div><button class="name" data-key="${esc(p.k)}" title="Click to give ${p.k.startsWith('d:') ? 'this browser' : 'this IP'} a name">${esc(name(p.k))}</button><div class="dim mono">${esc(sub)}</div></div></div></td>
                <td>${netCell(latest.ip)}</td><td>${esc(device(p.list.find(s => s.ua)?.ua || ''))}</td><td class="num">${p.list.length}</td>
                <td class="num"><b>${share(p.active, maxP)}</b></td><td class="num">${dur(p.open)}</td>
                <td title="${esc(new Date(p.last * 1000).toLocaleString())}">${on ? '<span class="live">● now</span>' : ago(p.last)}</td><td>${top(p.list, s => s.tool)}</td></tr>`;
        }).join('') : empty(8, none)}</tbody>`;

        $('tools').innerHTML = `<thead><tr><th>Tool</th><th class="num">People</th><th class="num">Visits</th><th class="num">Active</th><th class="num">Open</th><th>Last used</th><th>Top users</th></tr></thead><tbody>${tools.length ? tools.map(t => {
            const on = t.list.filter(isLive).length;
            return `<tr${fresh('t|' + t.k) ? ' class="new"' : ''}>
                <td><b>${esc(t.k)}</b></td><td class="num">${new Set(t.list.map(s => s.who)).size}</td><td class="num">${t.list.length}</td><td class="num"><b>${share(t.active, maxT)}</b></td><td class="num">${dur(t.open)}</td>
                <td title="${esc(new Date(t.last * 1000).toLocaleString())}">${on ? `<span class="live">● ${on} using now</span>` : ago(t.last)}</td><td>${top(t.list, s => name(s.who))}</td></tr>`;
        }).join('') : empty(7, none)}</tbody>`;

        $('sessions').innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Where</th><th>Tool</th><th class="num">Active</th><th class="num">Open</th><th>Device</th></tr></thead><tbody>${rows.length ? rows.slice(0, shown).map(s => {
            const tags = (isLive(s) ? ' <span class="live">● now</span>' : '') + (s.reloads ? ` <span class="dim" title="Reopened within ${RELOAD_GAP}s - counted as one visit">↻${s.reloads}</span>` : '') + (s.past ? ' <span class="tag">history</span>' : '');
            return `<tr${fresh('v|' + s.key) ? ' class="new"' : ''}><td title="${esc(new Date(s.start * 1000).toLocaleString())} → ${esc(new Date(s.end * 1000).toLocaleString())}">${when(s.start)}${tags}</td>
                <td><div class="person">${avatar(s.who, false, true)}<span>${esc(name(s.who))}</span></div></td><td>${netCell(s.ip)}</td><td><b>${esc(s.tool)}</b><div class="dim mono" title="${esc(s.title)}">${esc(pageOf(s))}</div></td>
                <td class="num"><b>${time(s, s.active)}</b></td><td class="num">${time(s, s.open)}</td><td title="${esc(s.ua)}">${esc(device(s.ua))}</td></tr>`;
        }).join('') : empty(7, none)}</tbody>`;
        $('more').hidden = rows.length <= shown;
        $('more').textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;

        const i = data.integrity;
        $('foot').textContent = `Log folder: ${data.logDir}` + (i.since ? ` · tracking since ${new Date(i.since * 1000).toLocaleString()}` : '')
            + ' · rows tagged "history" come from Apache\'s log (page opened, no time data)';
        firstRender = false;
    }

    function csv() {
        const fp = $('fPerson').value, ft = $('fTool').value, fn = $('fNet').value;
        const rows = visits().filter(s => (!fp || s.who === fp) && (!ft || s.tool === ft) && (!fn || s.net === fn));
        // Quote every cell; a leading = + - @ gets a ' so Excel can't run it as a formula.
        const cell = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
        const iso = t => new Date(t * 1000).toLocaleString('sv-SE').replace(' ', 'T');
        const lines = [['Start', 'End', 'Who', 'IP', 'Device ID', 'Network', 'Tool', 'Page', 'Active (s)', 'Open (s)', 'Browser', 'Source']]
            .concat(rows.map(s => [iso(s.start), iso(s.end), name(s.who), s.ip, s.dev, s.net, s.tool, pageOf(s), s.past ? '' : s.active, s.past ? '' : s.open, device(s.ua), s.past ? 'Apache history' : 'Tracked']));
        const blob = new Blob(['﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tool-usage-${range === 'today' ? 'today' : range === 'all' ? 'all' : range + 'd'}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // Every second: tick the Live now timers. Every 10 s: re-render so tabs that
    // stopped reporting drop out of Live now and "x min ago" stays right.
    let ticks = 0;
    setInterval(() => {
        if (!data || document.hidden) return;
        document.querySelectorAll('[data-since]').forEach(el => { el.textContent = clock(now() - el.dataset.since); });
        status();
        if (++ticks % 10 === 0) render();
    }, 1000);
    setInterval(() => { if (!document.hidden) load().catch(() => { }); }, FULL_CHECK);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); else status(); });
    let resizeTimer;
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (data) { chartKey = ''; render(); } }, 150); });

    // ── controls ──

    const onFilter = () => { shown = 200; render(); };
    $('people').addEventListener('click', async e => {
        const btn = e.target.closest('button.name');
        if (!btn) return;
        const key = btn.dataset.key;
        const what = key.startsWith('d:') ? `this browser (device ${key.slice(2, 6)}, last on ${lastIp.get(key)})` : key;
        const value = prompt(`Name for ${what} (leave empty to remove):`, data.labels[key] || '');
        if (value === null) return;
        const res = await fetch('labels.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Usage-Report': '1' }, body: JSON.stringify({ ip: key, name: value }) });
        if (!res.ok) return alert('Could not save the name.');
        data.labels = (await res.json()).labels;
        chartKey = '';
        fillFilters();
        render();
    });
    $('range').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        $('range').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        range = b.dataset.range;
        shown = 200;
        firstRender = true;
        seen.clear();
        load().catch(() => { });
    });
    $('metric').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        $('metric').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        metric = b.dataset.metric;
        render();
    });
    $('tabs').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        tab = b.dataset.tab;
        $('tabs').querySelectorAll('button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
        document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
        $('tabHint').textContent = { people: 'One row per browser · click a name to rename', tools: 'Every tool used in this range', visits: 'One row per page opened (quick reloads merged), newest first' }[tab];
    });
    ['fPerson', 'fTool', 'fNet'].forEach(id => $(id).addEventListener('change', onFilter));
    $('clear').addEventListener('click', () => { ['fPerson', 'fTool', 'fNet'].forEach(id => { $(id).value = ''; }); onFilter(); });
    $('more').addEventListener('click', () => { shown += 200; render(); });
    $('csv').addEventListener('click', csv);
    $('theme').addEventListener('click', () => {
        const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('theme', t); } catch (e) { }
    });

    poll();
})();
