/*
 * Tool usage report, live. data.php gives the sessions once; live.php is then
 * polled every POLL ms for only the log lines written since, which
 * applyEntry() folds in (the same rules data.php uses). Rows that appear flash,
 * the Live now timers tick every second, and the whole log is re-checked in
 * full every FULL_CHECK ms. Polling pauses while this tab is hidden.
 */
(() => {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const RELOAD_GAP = 10;      // s: reopening the same page this soon counts as the same visit
    const LIVE_WINDOW = 45;     // s: a tab that reported within this long is "live" (it reports every 15 s)
    const ACTIVE_WINDOW = 40;   // s: live and its active time went up within this long = "Active", else "Idle"
    const POLL = 2000, FULL_CHECK = 5 * 60e3;

    let data = null, sessions = new Map(), cursor = null, range = 'today', shown = 200;
    let skew = 0, lastOk = 0, failures = 0, dirty = false, pollTimer = null, loading = null;
    const seen = new Set();
    let firstRender = true;

    const now = () => Date.now() / 1000 + skew;
    const dur = s => {
        if (!s) return '0m';
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
        return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m` : `${s}s`;
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
    const lastIp = new Map();
    const name = key => data.labels[key] || (key.startsWith('d:') ? (data.labels[lastIp.get(key)] || lastIp.get(key)) : key);
    const netCell = ip => {
        const n = net(ip);
        const cls = n === 'Internet' ? 'ext' : n === 'This PC' ? 'me' : 'lan';
        const link = n === 'Internet' ? ` <a href="https://ipinfo.io/${encodeURIComponent(ip)}" target="_blank" rel="noopener noreferrer" title="Look up where this IP is">where?</a>` : '';
        return `<span class="net ${cls}">${n}</span>${link}`;
    };
    const time = (s, v) => s.past ? '<span class="dim" title="From Apache\'s log - no time data before tracking started">—</span>' : dur(v);
    const pageOf = s => s.path.replace(/^\/salvadore\//, '') + (s.tabs.length ? ' ' + s.tabs.join(' ') : '');

    function since() {
        if (range === 'all') return 0;
        if (range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d / 1000); }
        return Math.floor(Date.now() / 1000) - range * 86400;
    }

    // ── data ──

    const lastIpAt = new Map();
    function remember(s) {
        s.net = net(s.ip);
        s.who = s.dev ? 'd:' + s.dev : s.ip;
        if (s.dev && s.start >= (lastIpAt.get(s.who) ?? -1)) {
            lastIp.set(s.who, s.ip);
            lastIpAt.set(s.who, s.start);
        }
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
        loading = (async () => {
            const res = await fetch('data.php?since=' + since(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            data = await res.json();
            skew = data.now - Date.now() / 1000;
            sessions = new Map();
            lastIp.clear();
            lastIpAt.clear();
            data.sessions.forEach(s => { sessions.set(s.key, s); remember(s); });
            cursor = data.integrity.cursor;
            lastOk = Date.now();
            failures = 0;
            fillFilters();
            render();
        })().finally(() => { loading = null; });
        return loading;
    }

    async function poll() {
        clearTimeout(pollTimer);
        if (document.hidden) return status();
        try {
            if (!data) {
                await load();
            } else {
                const q = new URLSearchParams(cursor);
                const res = await fetch('live.php?' + q, { cache: 'no-store' });
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
                        if (newPeople) fillFilters();
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

    // ── view ──

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
        })).sort((a, b) => b.active - a.active || b.last - a.last);
    }
    const top = (list, key, n = 3) => group(list, key).slice(0, n).map(g => `${esc(g.k)} <span class="dim">${g.list.every(s => s.past) ? g.list.length + '×' : dur(g.active)}</span>`).join(', ');
    const isLive = s => !s.past && !s.closed && now() - s.end <= LIVE_WINDOW;
    const isActive = s => now() - Math.max(s.activeAt, s.active ? 0 : s.start) <= ACTIVE_WINDOW;
    const fresh = key => { const n = !firstRender && !seen.has(key); seen.add(key); return n ? ' class="new"' : ''; };

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
            box.innerHTML = tiles.map(([l]) => `<div class="tile"><span>${l}</span><b></b></div>`).join('');
        }
        tiles.forEach(([, v], i) => {
            const b = box.children[i].querySelector('b');
            if (b.innerHTML !== String(v)) {
                if (!firstRender) { b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 900); }
                b.innerHTML = v;
            }
        });
    }

    function render() {
        integrity();
        const fp = $('fPerson').value, ft = $('fTool').value, fn = $('fNet').value;
        const match = s => (!fp || s.who === fp) && (!ft || s.tool === ft) && (!fn || s.net === fn);
        const rows = visits().filter(match);
        const people = group(rows, s => s.who), tools = group(rows, s => s.tool);
        const live = [...sessions.values()].filter(s => isLive(s) && match(s)).sort((a, b) => a.start - b.start);
        const tracked = rows.filter(s => !s.past);

        setTiles([
            ['Live now', live.length],
            ['People', people.length],
            ['Visits', rows.length],
            ['Active time', dur(tracked.reduce((a, s) => a + s.active, 0))],
            ['Open time', dur(tracked.reduce((a, s) => a + s.open, 0))],
            ['Most used', tools[0] ? esc(tools[0].k) : '—'],
        ]);

        const empty = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
        const none = data.integrity.entries ? 'Nothing in this range yet — new visits appear here as they happen.' : 'No visits recorded yet — they appear here as soon as someone opens a tool.';

        $('liveCount').textContent = live.length;
        $('live').innerHTML = `<thead><tr><th>Who</th><th>Tool</th><th>Where</th><th>Status</th><th class="num">On page</th><th class="num">Active</th><th>Device</th></tr></thead><tbody>${live.length ? live.map(s => {
            const act = isActive(s);
            return `<tr${fresh('live|' + s.key)}><td><b>${esc(name(s.who))}</b><div class="dim mono">${esc(s.ip)}</div></td>
                <td><b>${esc(s.tool)}</b><div class="dim mono" title="${esc(s.title)}">${esc(pageOf(s))}</div></td>
                <td>${netCell(s.ip)}</td>
                <td><span class="state ${act ? 'active' : 'idle'}" title="${act ? 'Clicking, typing or scrolling in the last minute' : 'Tab open and visible, but no input lately'}">${act ? 'Active' : 'Idle'}</span></td>
                <td class="num clock" data-since="${s.start}">${clock(now() - s.start)}</td>
                <td class="num">${dur(s.active)}</td><td title="${esc(s.ua)}">${esc(device(s.ua))}</td></tr>`;
        }).join('') : empty(7, 'Nobody has a tool open right now.')}</tbody>`;

        $('people').innerHTML = `<thead><tr><th>Who</th><th>Where</th><th>Device</th><th class="num">Visits</th><th class="num">Active</th><th class="num">Open</th><th>Last seen</th><th>Top tools</th></tr></thead><tbody>${people.length ? people.map(p => {
            const latest = p.list.reduce((a, s) => s.start > a.start ? s : a);
            const ips = [...new Set(p.list.map(s => s.ip))];
            const sub = [p.k.startsWith('d:') ? `device ${p.k.slice(2, 6)}` : '', ips.join(', ')].filter(Boolean).join(' · ');
            const on = p.list.some(isLive);
            return `<tr${fresh('p|' + p.k)}><td><button class="name" data-key="${esc(p.k)}" title="Click to give ${p.k.startsWith('d:') ? 'this browser' : 'this IP'} a name">${esc(name(p.k))}</button><div class="dim mono">${esc(sub)}</div></td>
                <td>${netCell(latest.ip)}</td><td>${esc(device(p.list.find(s => s.ua)?.ua || ''))}</td><td class="num">${p.list.length}</td>
                <td class="num"><b>${dur(p.active)}</b></td><td class="num">${dur(p.open)}</td>
                <td title="${esc(new Date(p.last * 1000).toLocaleString())}">${on ? '<span class="live">● now</span>' : ago(p.last)}</td><td>${top(p.list, s => s.tool)}</td></tr>`;
        }).join('') : empty(8, none)}</tbody>`;

        $('tools').innerHTML = `<thead><tr><th>Tool</th><th class="num">People</th><th class="num">Visits</th><th class="num">Active</th><th class="num">Open</th><th>Last used</th><th>Top users</th></tr></thead><tbody>${tools.length ? tools.map(t => {
            const on = t.list.filter(isLive).length;
            return `<tr${fresh('t|' + t.k)}>
                <td><b>${esc(t.k)}</b></td><td class="num">${new Set(t.list.map(s => s.who)).size}</td><td class="num">${t.list.length}</td><td class="num"><b>${dur(t.active)}</b></td><td class="num">${dur(t.open)}</td>
                <td title="${esc(new Date(t.last * 1000).toLocaleString())}">${on ? `<span class="live">● ${on} using now</span>` : ago(t.last)}</td><td>${top(t.list, s => name(s.who))}</td></tr>`;
        }).join('') : empty(7, none)}</tbody>`;

        $('sessions').innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Where</th><th>Tool</th><th class="num">Active</th><th class="num">Open</th><th>Device</th></tr></thead><tbody>${rows.length ? rows.slice(0, shown).map(s => {
            const tags = (isLive(s) ? ' <span class="live">● now</span>' : '') + (s.reloads ? ` <span class="dim" title="Reopened within ${RELOAD_GAP}s - counted as one visit">↻${s.reloads}</span>` : '') + (s.past ? ' <span class="tag">history</span>' : '');
            return `<tr${fresh('v|' + s.key)}><td title="${esc(new Date(s.start * 1000).toLocaleString())} → ${esc(new Date(s.end * 1000).toLocaleString())}">${when(s.start)}${tags}</td>
                <td>${esc(name(s.who))}</td><td>${netCell(s.ip)}</td><td><b>${esc(s.tool)}</b><div class="dim mono" title="${esc(s.title)}">${esc(pageOf(s))}</div></td>
                <td class="num"><b>${time(s, s.active)}</b></td><td class="num">${time(s, s.open)}</td><td title="${esc(s.ua)}">${esc(device(s.ua))}</td></tr>`;
        }).join('') : empty(7, none)}</tbody>`;
        $('more').hidden = rows.length <= shown;
        $('more').textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;

        const i = data.integrity;
        $('foot').textContent = `Log folder: ${data.logDir}` + (i.since ? ` · tracking since ${new Date(i.since * 1000).toLocaleString()}` : '')
            + ' · rows tagged "history" come from Apache\'s log (page opened, no time data)';
        firstRender = false;
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

    // ── controls ──

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
    ['fPerson', 'fTool', 'fNet'].forEach(id => $(id).addEventListener('change', () => { shown = 200; render(); }));
    $('more').addEventListener('click', () => { shown += 200; render(); });
    $('theme').addEventListener('click', () => {
        const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('theme', t); } catch (e) { }
    });

    poll().catch(err => {
        $('integrity').className = 'pill bad';
        $('integrity').textContent = 'Could not load the log: ' + err.message;
    });
})();
