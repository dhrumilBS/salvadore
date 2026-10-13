/* Salvadore home (index.php): search, group filter, recently opened, theme.
 * Keys: "/" focuses search, Enter opens the first match, Esc clears. */
(() => {
    const RECENT_KEY = 'home.recent';
    const RECENT_MAX = 4;
    const store = {
        get(area, k, d) { try { return JSON.parse(window[area].getItem(k)) ?? d; } catch (e) { return d; } },
        set(area, k, v) { try { window[area].setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };

    const q = document.getElementById('q');
    const sections = [...document.querySelectorAll('section[data-group]')];
    const cards = [...document.querySelectorAll('section[data-group] .card')];
    const recent = document.getElementById('recent');
    let group = '';

    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cards.forEach(c => { c._name = c.querySelector('.name').textContent; });

    function highlight(text, terms) {
        if (!terms.length) return esc(text);
        const re = new RegExp(terms.map(reEsc).join('|'), 'gi');
        return esc(text).replace(re, m => `<mark>${m}</mark>`);
    }

    /* Recently opened: the last few tools clicked on this page (this browser only). */
    function renderRecent() {
        const paths = store.get('localStorage', RECENT_KEY, []);
        const grid = document.getElementById('recentGrid');
        grid.innerHTML = '';
        paths.forEach(p => {
            const card = cards.find(c => c.dataset.path === p && c.tagName === 'A');
            if (card) grid.appendChild(card.cloneNode(true));
        });
        return grid.children.length;
    }
    const hasRecent = renderRecent();

    function apply() {
        const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        let first = null;
        sections.forEach(s => {
            let n = 0;
            s.querySelectorAll('.card').forEach(c => {
                const ok = (!group || s.dataset.group === group) && terms.every(t => c.dataset.search.includes(t));
                c.hidden = !ok;
                c.querySelector('.name').innerHTML = highlight(c._name, terms);
                c.classList.remove('is-first');
                if (ok) {
                    n++;
                    if (!first && c.tagName === 'A') first = c;
                }
            });
            s.hidden = n === 0;
            shown += n;
        });
        // Enter opens the first match - mark it while searching.
        if (terms.length && first) first.classList.add('is-first');
        recent.hidden = !hasRecent || terms.length > 0 || group !== '';
        document.getElementById('empty').hidden = shown > 0;
        document.getElementById('emptyQ').textContent = q.value;
        store.set('sessionStorage', 'home.q', q.value);
        store.set('sessionStorage', 'home.g', group);
        return first;
    }

    function setGroup(btn) {
        group = btn.dataset.group;
        document.querySelectorAll('#groups button').forEach(x => x.classList.toggle('active', x === btn));
        apply();
    }

    q.addEventListener('input', apply);
    document.getElementById('groups').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) setGroup(b);
    });

    // Remember what was opened (cards in "Recently opened" count too).
    document.addEventListener('click', e => {
        const card = e.target.closest('a.card');
        if (!card) return;
        const list = store.get('localStorage', RECENT_KEY, []).filter(p => p !== card.dataset.path);
        list.unshift(card.dataset.path);
        store.set('localStorage', RECENT_KEY, list.slice(0, RECENT_MAX));
    });

    document.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement !== q && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
            e.preventDefault();
            q.focus();
            q.select();
        } else if (e.key === 'Escape' && document.activeElement === q) {
            q.value = '';
            apply();
            q.blur();
        } else if (e.key === 'Enter' && document.activeElement === q) {
            const first = apply();
            if (first) first.click();
        }
    });

    document.getElementById('theme').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (err) { /* private mode */ } // plain string: read raw in <head>
    });

    // Come back to the same search/filter after opening a tool and pressing Back.
    q.value = store.get('sessionStorage', 'home.q', '');
    const btn = document.querySelector(`#groups button[data-group="${CSS.escape(store.get('sessionStorage', 'home.g', ''))}"]`);
    if (btn) setGroup(btn); else apply();
})();
