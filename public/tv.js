/* Écran TV : salle d'attente (QR code, joueurs, réglages) puis affichage du jeu */
(async function () {
  'use strict';
  const { h, api, stream, toast } = Socle;
  const app = document.getElementById('app');
  const hostbar = document.getElementById('hostbar');
  const remote = document.getElementById('remote');

  let info = { ips: [], port: location.port, publicUrl: null };
  let room = null; // { code, hostKey }
  let state = null;
  let es = null;
  let lobby = null; // éléments de la salle d'attente
  let mode = null; // 'lobby' | 'game'
  const gameRoot = h('div', { class: 'game-root' });

  /* ----- adresse que les téléphones doivent ouvrir ----- */
  function baseUrl() {
    if (info.publicUrl) return info.publicUrl;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (local && info.ips.length) return 'http://' + info.ips[0] + (location.port ? ':' + location.port : '');
    return location.origin;
  }
  const joinUrl = () => baseUrl() + '/j/' + room.code;
  const remoteUrl = () => baseUrl() + '/host?r=' + room.code + '&k=' + room.hostKey;

  /* ----- salle ----- */
  async function ensureRoom() {
    try {
      const saved = JSON.parse(localStorage.getItem('pepites.tvRoom') || 'null');
      if (saved && saved.code) {
        const r = await fetch('/api/rooms/' + saved.code + '/exists');
        if (r.ok) return saved;
      }
    } catch (e) { /* on recrée une salle */ }
    let password = '';
    try { password = localStorage.getItem('pepites.pwd') || ''; } catch (e) { /* ignoré */ }
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await api('POST', '/api/rooms', { gameId: 'pepites', password });
        break;
      } catch (e) {
        if (!info.needsPassword || attempt >= 3) throw e;
        password = window.prompt(attempt ? 'Mot de passe incorrect. Réessayez :' : 'Mot de passe animateur :') || '';
        if (!password) throw e;
      }
    }
    try { if (password) localStorage.setItem('pepites.pwd', password); } catch (e) { /* ignoré */ }
    localStorage.setItem('pepites.tvRoom', JSON.stringify(created));
    return created;
  }

  async function newRoom() {
    localStorage.removeItem('pepites.tvRoom');
    if (es) es.close();
    state = null; mode = null; lobby = null;
    await boot();
  }

  async function hostSend(type, extra) {
    try {
      await api('POST', '/api/rooms/' + room.code + '/host', Object.assign({ key: room.hostKey, type }, extra));
    } catch (e) {
      toast(e.message);
    }
  }

  /* ----- salle d'attente ----- */
  function seg(label, options, key) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    options.forEach(([value, text]) => {
      wrap.append(h('button', { type: 'button', 'data-v': value, text, onclick: () => hostSend('settings', { [key]: value }) }));
    });
    return wrap;
  }

  function buildLobby() {
    const refs = {};
    refs.qr = h('div', { class: 'qr-frame' });
    refs.url = h('b');
    refs.code = h('span', { class: 'code' });
    refs.count = h('b', { text: '0' });
    refs.countLabel = h('span');
    refs.players = h('div', { class: 'players' });
    refs.gameName = h('span', { class: 'game-name' });
    refs.segQ = seg('Longueur de la partie', [[5, 'Express · 5'], [10, 'Courte · 10'], [15, 'Complète · 15']], 'questions');
    refs.segT = seg('Temps par question', [[15, '15 s'], [20, '20 s'], [30, '30 s'], [45, '45 s']], 'timer');
    refs.warn = h('p', { class: 'warn', hidden: true, role: 'alert', text: 'Le serveur utilise encore l’ancienne version : fermez la fenêtre noire du serveur puis relancez-le (Lancer-Mac.command), et rechargez cette page.' });
    refs.segA = seg('Passage à la question suivante', [['manual', 'Manuel'], ['auto', 'Automatique']], 'advance');
    refs.start = h('button', { class: 'btn btn-gold start-btn', type: 'button', onclick: () => hostSend('start') }, 'Lancer la partie');
    refs.el = h('div', { class: 'lobby' },
      h('header', { class: 'lobby-head' }, h('span', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Pépites'), refs.gameName),
      h('main', { class: 'lobby-main' },
        h('section', { class: 'qr-card' }, refs.qr, h('div', { class: 'qr-caption' }, 'Scannez pour jouer')),
        h('section', { class: 'lobby-side' },
          h('h1', { class: 'lobby-title' }, 'Sortez votre téléphone, il devient votre manette.'),
          h('p', { class: 'lobby-sub' }, 'Scannez le QR code, choisissez un pseudo, puis regardez l’écran. Aucune application à installer.'),
          h('p', { class: 'join-line' }, 'Pas de QR code ? Allez sur ', refs.url, ' avec le code', refs.code),
          h('div', { class: 'players-head' }, refs.count, refs.countLabel),
          refs.players,
          refs.warn,
          h('p', { class: 'kbd-hint', text: 'Clavier : Entrée lance la partie · H affiche la télécommande · F passe en plein écran' }))),
      h('footer', { class: 'lobby-bar' },
        h('div', { class: 'setting' }, h('span', { text: 'Partie' }), refs.segQ),
        h('div', { class: 'setting' }, h('span', { text: 'Temps' }), refs.segT),
        h('div', { class: 'setting' }, h('span', { text: 'Question suivante' }), refs.segA),
        h('div', { class: 'spacer' }),
        refs.start));
    refs.renderedCode = null;
    return refs;
  }

  function updateLobby() {
    const r = lobby;
    r.gameName.textContent = state.gameName;
    if (r.renderedCode !== room.code + joinUrl()) {
      r.qr.innerHTML = QR.svg(joinUrl(), { margin: 0 });
      r.url.textContent = joinUrl().replace(/\/j\/.*$/, '').replace(/^https?:\/\//, '') + '/jouer';
      r.code.textContent = room.code;
      r.renderedCode = room.code + joinUrl();
    }
    const n = state.players.length;
    r.count.textContent = n;
    r.countLabel.textContent = n > 1 ? ' joueurs dans la salle' : ' joueur dans la salle';
    r.players.replaceChildren();
    if (!n) r.players.append(h('span', { class: 'empty-hint', text: 'En attente du premier joueur…' }));
    state.players.forEach((p) => {
      r.players.append(h('span', { class: 'pchip' + (p.connected ? '' : ' off') }, p.name,
        h('button', { type: 'button', title: 'Retirer ce joueur', 'aria-label': 'Retirer ' + p.name, onclick: () => hostSend('kick', { pid: p.id }) }, '✕')));
    });
    [[r.segQ, state.settings.questions], [r.segT, state.settings.timer], [r.segA, state.settings.advance]].forEach(([wrap, value]) => {
      wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
    });
    r.start.disabled = n < 1;
    // Un serveur resté sur l'ancienne version ne connaît pas le réglage « Question suivante ».
    r.warn.hidden = state.settings.advance !== undefined;
  }

  /* ----- barre animateur ----- */
  function updateHostbar() {
    hostbar.replaceChildren();
    if (state.phase === 'lobby') { hostbar.hidden = true; return; }
    hostbar.hidden = false;
    const phase = state.game.phase;
    const btn = (text, fn, cls) => hostbar.append(h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: fn }, text));
    if (phase === 'finished') {
      btn('Rejouer (même salle)', () => hostSend('restart'), 'btn-gold');
      btn('Nouvelle salle', () => newRoom());
    } else {
      const next = { intro: 'Passer l’introduction', question: 'Révéler la réponse', reveal: 'Question suivante' }[phase];
      if (next) btn(next + '  (Espace)', () => hostSend('next'), 'btn-gold');
      btn('Terminer la partie', () => { if (confirm('Terminer la partie maintenant ?')) hostSend('end'); });
    }
  }

  /* ----- rendu ----- */
  function render() {
    if (!state) return;
    if (state.phase === 'lobby') {
      if (mode !== 'lobby') {
        if (!lobby) lobby = buildLobby();
        lobby.renderedCode = null;
        app.replaceChildren(lobby.el);
        mode = 'lobby';
      }
      updateLobby();
    } else {
      if (mode !== 'game') {
        gameRoot._key = null;
        app.replaceChildren(gameRoot);
        mode = 'game';
      }
      GameViews[state.gameId].tv(gameRoot, state.game, { players: state.players });
    }
    updateHostbar();
  }

  /* ----- télécommande animateur ----- */
  function toggleRemote(force) {
    const show = force != null ? force : remote.hidden;
    remote.hidden = !show;
    if (!show) return;
    const qr = h('div', { class: 'qr-frame' });
    qr.innerHTML = QR.svg(remoteUrl(), { margin: 0 });
    remote.replaceChildren(h('div', { class: 'remote-card' },
      h('h2', { text: 'Télécommande animateur' }),
      qr,
      h('p', { text: 'Scannez avec VOTRE téléphone pour piloter la partie à distance. Ce code donne le contrôle : ne le montrez pas aux clients.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => toggleRemote(false) }, 'Fermer')));
  }

  /* ----- clavier, souris ----- */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key;
    if (k === 'Escape') toggleRemote(false);
    else if (k === 'h' || k === 'H') toggleRemote();
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
      if (!state) return;
      e.preventDefault();
      if (state.phase === 'lobby') { if (k === 'Enter' && state.players.length) hostSend('start'); }
      else if (state.game.phase !== 'finished') hostSend('next');
    }
  });
  let idleTimer = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
  }
  document.addEventListener('mousemove', wake);
  document.addEventListener('keydown', wake);
  wake();

  /* ----- démarrage ----- */
  async function boot() {
    try {
      room = await ensureRoom();
    } catch (e) {
      app.replaceChildren(h('div', { class: 'screen-msg' }, h('div', { text: 'Impossible de joindre le serveur.' }), h('div', { text: 'Vérifiez qu’il est bien lancé, puis rechargez la page.' })));
      return;
    }
    es = stream('/api/rooms/' + room.code + '/stream?role=tv', {
      state: (s) => { state = s; render(); },
      gone: async () => { localStorage.removeItem('pepites.tvRoom'); await newRoom(); },
    });
  }

  try { info = await api('GET', '/api/info'); } catch (e) { /* valeurs par défaut */ }
  await boot();
})();
