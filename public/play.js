/* Téléphone du joueur : pseudo, salle d'attente, puis manette du jeu */
(function () {
  'use strict';
  const { h, api, stream, toast } = Socle;
  const app = document.getElementById('app');
  const statusEl = document.getElementById('status');

  const fromPath = (location.pathname.match(/^\/j\/([A-Za-z]{4})/) || [])[1];
  const code = String(fromPath || new URLSearchParams(location.search).get('r') || '').toUpperCase();
  const storeKey = 'pepites.player.' + code;

  let creds = null; // { pid, token, name }
  let state = null;
  let es = null;
  let mode = null;
  const gameRoot = h('div', { class: 'game-root' });
  const waitRefs = {};

  function show(el) { app.replaceChildren(el); }

  /* ----- écrans d'accueil ----- */
  function codeScreen(message) {
    const input = h('input', { class: 'code-input', type: 'text', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'ABCD', 'aria-label': 'Code de la salle' });
    const err = h('div', { class: 'err', text: message || '' });
    show(h('div', { class: 'welcome' },
      h('span', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Pépites'),
      h('h1', { text: 'Rejoindre une partie' }),
      h('p', { text: 'Saisissez le code affiché sur l’écran, ou scannez le QR code.' }),
      h('form', { onsubmit: (e) => { e.preventDefault(); const c = input.value.trim().toUpperCase(); if (c.length === 4) location.href = '/j/' + c; else err.textContent = 'Le code comporte 4 lettres.'; } },
        input, err, h('button', { class: 'btn btn-gold', type: 'submit' }, 'Rejoindre'))));
  }

  function nameScreen(message) {
    let last = '';
    try { last = localStorage.getItem('pepites.lastName') || ''; } catch (e) { /* ignoré */ }
    const input = h('input', { type: 'text', maxlength: '14', autocomplete: 'nickname', enterkeyhint: 'go', placeholder: 'Ton pseudo', value: last, id: 'name' });
    const err = h('div', { class: 'err', text: message || '' });
    const btn = h('button', { class: 'btn btn-gold', type: 'submit' }, 'Rejoindre la partie');
    show(h('div', { class: 'welcome' },
      h('span', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Pépites'),
      h('h1', { text: 'Choisis ton pseudo' }),
      h('p', { text: 'Il s’affichera sur l’écran du bar. Reste sympa !' }),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          try {
            const name = input.value.trim();
            creds = await api('POST', '/api/rooms/' + code + '/join', { name });
            try { localStorage.setItem(storeKey, JSON.stringify(creds)); localStorage.setItem('pepites.lastName', creds.name); } catch (x) { /* ignoré */ }
            connect();
          } catch (x) {
            err.textContent = x.message;
            btn.disabled = false;
          }
        },
      }, h('label', { for: 'name', class: 'sr-only', text: 'Pseudo' }), input, err, btn)));
    setTimeout(() => input.focus(), 50);
  }

  function missingRoom() {
    show(h('div', { class: 'welcome' },
      h('span', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Pépites'),
      h('h1', { text: 'Cette salle n’existe pas' }),
      h('p', { text: 'Elle est peut-être terminée. Scannez à nouveau le QR code affiché sur l’écran, ou saisissez un autre code.' }),
      h('a', { class: 'btn btn-gold', href: '/jouer', style: 'text-align:center;text-decoration:none' }, 'Saisir un code')));
  }

  /* ----- salle d'attente ----- */
  function waitScreen() {
    if (!waitRefs.el) {
      waitRefs.name = h('span', { class: 'me' });
      waitRefs.count = h('p');
      waitRefs.el = h('div', { class: 'pp wait' },
        h('img', { src: '/logo.svg', alt: '' }),
        h('h2', null, 'Tu es dans la salle, ', waitRefs.name),
        h('p', { text: 'Regarde l’écran : la partie va bientôt commencer.' }),
        waitRefs.count);
    }
    waitRefs.name.textContent = state.me.name;
    waitRefs.count.textContent = state.playersCount + ' ' + (state.playersCount > 1 ? 'joueurs dans la salle' : 'joueur dans la salle');
    return waitRefs.el;
  }

  /* ----- connexion ----- */
  const act = (type, data) => api('POST', '/api/rooms/' + code + '/act', { pid: creds.pid, token: creds.token, type, data });

  function render() {
    if (!state) return;
    if (state.phase === 'lobby') {
      if (mode !== 'lobby') { gameRoot._key = null; show(waitScreen()); mode = 'lobby'; }
      waitScreen();
    } else {
      if (mode !== 'game') { gameRoot._key = null; show(gameRoot); mode = 'game'; }
      GameViews[state.gameId].player(gameRoot, state.game, { act, me: state.me });
    }
  }

  function connect() {
    if (es) es.close();
    mode = null;
    es = stream('/api/rooms/' + code + '/stream?role=player&pid=' + creds.pid + '&token=' + creds.token, {
      state: (s) => { state = s; statusEl.hidden = true; render(); },
      status: (ok) => { if (!ok) statusEl.hidden = false; else statusEl.hidden = true; },
      gone: async () => {
        es.close();
        try { localStorage.removeItem(storeKey); } catch (e) { /* ignoré */ }
        creds = null;
        statusEl.hidden = true;
        // La salle existe-t-elle encore ? Sinon, message dédié.
        const r = await fetch('/api/rooms/' + code + '/exists').catch(() => null);
        if (r && r.ok) nameScreen('Tu as été retiré de la salle. Tu peux la rejoindre à nouveau.');
        else missingRoom();
      },
    });
  }

  /* ----- démarrage ----- */
  (async function boot() {
    if (!code) return codeScreen();
    const exists = await fetch('/api/rooms/' + code + '/exists').catch(() => null);
    if (!exists || !exists.ok) return missingRoom();
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
      if (saved && saved.pid) {
        creds = await api('POST', '/api/rooms/' + code + '/join', { pid: saved.pid, token: saved.token, name: saved.name });
        if (creds.pid === saved.pid) return connect();
      }
    } catch (e) { /* pas de session valide : on demande un pseudo */ }
    nameScreen();
  })();
})();
