/* ══════════════════════════ Saved views ══════════════════════════
 * "★ Views" menu on the filter panel of Content, Links & UTM and Redirects:
 * save the current filters under a name, re-apply them with one click.
 * Generic on purpose - it snapshots the panel's own controls (selects,
 * inputs, checkboxes, the active button of each tab-group) instead of each
 * tab's internal state, and re-applies them by setting values and firing
 * the same change/input/click events a person would. Stored per site and
 * per tab in localStorage (md.views.<site>.<tab>), so views never leak
 * between Healthray and Botphonic. Plain globals: bindSavedViews(). */

const SAVED_VIEW_TABS = {
    content:   { root: '#contentView',   label: 'Content' },
    redirects: { root: '#redirectsView', label: 'Redirects' },
};

/** The tab's filter card = its first .card-panel. */
function svPanel(tab) {
    return document.querySelector(`${SAVED_VIEW_TABS[tab].root} > .card-panel`);
}

function svKey(tab) { return `views.${SITE}.${tab}`; }

function svLoad(tab) {
    const v = mdStore.get(svKey(tab), []);
    return Array.isArray(v) ? v : [];
}

function svStore(tab, views) {
    if (!mdStore.set(svKey(tab), views)) toast('Could not save the view (browser storage is full or blocked)', 'err');
}

/** Snapshot every filter control in the panel by id, plus the active button of each tab-group. */
function svSnapshot(tab) {
    const panel = svPanel(tab);
    const fields = {};
    panel.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
        if (el.type === 'button' || el.type === 'submit' || el.closest('.sv-menu')) return;
        fields[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
    panel.querySelectorAll('input[type="checkbox"]:not([id])').forEach((el, i) => {
        if (!el.closest('.sv-menu')) fields[`#cb${i}:${el.className}:${el.value}`] = el.checked;
    });
    const tabs = {};
    panel.querySelectorAll('.tab-group[id]').forEach(g => {
        const active = g.querySelector('.tab.active');
        if (active) tabs[g.id] = { ...active.dataset };
    });
    return { fields, tabs };
}

/** Re-apply a snapshot: values first (a status change can rebuild the type tabs), then tab buttons. */
function svApply(tab, view) {
    const panel = svPanel(tab);
    const unnamed = panel.querySelectorAll('input[type="checkbox"]:not([id])');
    Object.entries(view.fields || {}).forEach(([id, value]) => {
        let el;
        if (id.startsWith('#cb')) {
            const [, idx, cls, val] = id.match(/^#cb(\d+):([^:]*):(.*)$/) || [];
            el = unnamed[+idx];
            if (!el || el.className !== cls || el.value !== val) return;
        } else {
            el = document.getElementById(id);
        }
        if (!el || !panel.contains(el)) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
            if (el.checked === value) return;
            el.checked = value;
        } else {
            if (el.value === value) return;
            if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === value)) return; // option gone on this site
            el.value = value;
        }
        el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' ? 'change' : 'input', { bubbles: true }));
    });
    Object.entries(view.tabs || {}).forEach(([groupId, data]) => {
        const sel = Object.entries(data).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`).join('');
        const btn = document.querySelector(`#${CSS.escape(groupId)} .tab${sel}`);
        if (btn && !btn.classList.contains('active')) btn.click();
    });
}

function svRenderMenu(tab) {
    const menu = document.getElementById(`sv-menu-${tab}`);
    const views = svLoad(tab);
    menu.innerHTML = `
        <div class="sv-head">Saved views · ${escapeHtml(SAVED_VIEW_TABS[tab].label)}</div>
        ${views.length ? views.map((v, i) => `
            <div class="sv-item">
                <button type="button" class="sv-apply" data-i="${i}" title="Apply these filters">${escapeHtml(v.name)}</button>
                <button type="button" class="sv-del" data-i="${i}" title="Delete this view" aria-label="Delete view ${escapeHtml(v.name)}">×</button>
            </div>`).join('')
        : '<div class="sv-empty">No saved views yet. Set up the filters you use often, then save them here.</div>'}
        <form class="sv-save">
            <input type="text" maxlength="40" placeholder="Name, e.g. Missing meta descriptions" aria-label="View name" required>
            <button type="submit" class="btn primary small">Save current</button>
        </form>`;
}

function svClose() {
    document.querySelectorAll('.sv-wrap.open').forEach(w => w.classList.remove('open'));
}

function bindSavedViews() {
    Object.keys(SAVED_VIEW_TABS).forEach(tab => {
        const panel = svPanel(tab);
        const label = panel && panel.querySelector('.panel-label');
        if (!label) return;
        const wrap = document.createElement('div');
        wrap.className = 'sv-wrap';
        wrap.innerHTML = `
            <button type="button" class="btn small sv-btn" aria-haspopup="true" title="Save and re-apply filter combinations">★ Views</button>
            <div class="sv-menu" id="sv-menu-${tab}" role="menu"></div>`;
        label.insertBefore(wrap, label.children[1] || null);

        wrap.querySelector('.sv-btn').addEventListener('click', e => {
            e.stopPropagation();
            const open = !wrap.classList.contains('open');
            svClose();
            if (open) { svRenderMenu(tab); wrap.classList.add('open'); }
        });
        const menu = wrap.querySelector('.sv-menu');
        menu.addEventListener('click', e => {
            e.stopPropagation();
            const views = svLoad(tab);
            const apply = e.target.closest('.sv-apply');
            const del = e.target.closest('.sv-del');
            if (apply) {
                const v = views[+apply.dataset.i];
                if (v) { svApply(tab, v); toast(`Applied view “${v.name}”`, 'ok'); }
                svClose();
            } else if (del) {
                const v = views.splice(+del.dataset.i, 1)[0];
                svStore(tab, views);
                svRenderMenu(tab);
                if (v) toast(`Deleted view “${v.name}”`);
            }
        });
        menu.addEventListener('submit', e => {
            e.preventDefault();
            const input = menu.querySelector('.sv-save input');
            const name = input.value.trim();
            if (!name) return;
            const views = svLoad(tab).filter(v => v.name.toLowerCase() !== name.toLowerCase()); // same name = replace
            views.push({ name, ...svSnapshot(tab), saved: new Date().toISOString() });
            views.sort((a, b) => a.name.localeCompare(b.name));
            svStore(tab, views);
            svRenderMenu(tab);
            toast(`Saved view “${name}”`, 'ok');
        });
    });
    document.addEventListener('click', e => { if (!e.target.closest('.sv-wrap')) svClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') svClose(); });
}
