/*
 * Salvadore usage tracker - include on every tool page:
 *   <script src="<relative path>/usage/track.js" defer></script>
 * Reports which page was opened and how long it was used. "Open" counts
 * seconds the tab was visible; "active" only those where the window had focus
 * and saw a click, key, scroll or mouse move in the last 2 minutes. A random
 * device ID kept in this browser tells apart people who share an IP. Sends
 * nothing else from the page.
 */
(() => {
    const endpoint = new URL('collect.php', document.currentScript.src).href;
    const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    const sid = rand();
    let dev = '';
    try {
        dev = localStorage.getItem('salvadore-device') || '';
        if (!/^[0-9a-f]{16}$/.test(dev)) localStorage.setItem('salvadore-device', dev = rand());
    } catch (e) { dev = ''; }
    const TICK = 5, BEAT = 15, IDLE = 120e3;
    let open = 0, active = 0, sentOpen = 0, lastInput = Date.now();

    const send = (ev, extra) => {
        const body = JSON.stringify({ ev, sid, path: location.pathname, tab: location.hash.slice(0, 41), open, active, ...extra });
        try { navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' })); } catch (e) { }
    };
    const flush = () => { if (open !== sentOpen) { sentOpen = open; send('beat'); } };

    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(t =>
        addEventListener(t, () => { lastInput = Date.now(); }, { passive: true, capture: true }));

    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        open += TICK;
        if (document.hasFocus() && Date.now() - lastInput < IDLE) active += TICK;
        if (open - sentOpen >= BEAT) flush();
    }, TICK * 1000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
        else lastInput = Date.now();
    });
    addEventListener('hashchange', () => send('nav'));
    addEventListener('pagehide', () => send('end'));

    // A page Chrome prerenders in the background only counts once it's actually shown.
    const start = () => send('start', { title: document.title, ref: document.referrer, dev });
    if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true });
    else start();
})();
