/* Télécommande animateur (téléphone) : lancer, passer, terminer, sans toucher à l'ordinateur */
(function () {
  'use strict';
  const { h, api, stream, toast } = Socle;
  const app = document.getElementById('app');
  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const code = String(params.get('r') || '').toUpperCase();
  const key = params.get('k') || '';

  let state = null;

  const send = (type, extra) =>
    api('POST', '/api/rooms/' + code + '/host', Object.assign({ key, type }, extra)).catch((e) => toast(e.message));

  const PHASE_LABEL = { intro: 'Présentation', question: 'Question en cours', reveal: 'Réponse affichée', finished: 'Partie terminée' };

  function render() {
    const s = state;
    const children = [h('h1', { text: s.gameName }), h('div', { class: 'sub', text: 'Salle ' + code })];
    const players = h('ul', null, s.players.map((p) => h('li', { class: p.connected ? '' : 'off', text: p.name })));
    children.push(h('div', { class: 'box' }, h('b', { text: s.players.length + (s.players.length > 1 ? ' joueurs' : ' joueur') }), players));

    if (s.phase === 'lobby') {
      const sel = (label, field, options, value) =>
        h('label', { class: 'field' }, label,
          h('select', { onchange: (e) => send('settings', { [field]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) }) },
            options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value), text: t }))));
      children.push(
        sel('Longueur de la partie', 'questions', [[5, '5 questions'], [10, '10 questions'], [15, '15 questions']], s.settings.questions),
        sel('Temps par question', 'timer', [[15, '15 secondes'], [20, '20 secondes'], [30, '30 secondes'], [45, '45 secondes']], s.settings.timer),
        sel('Question suivante', 'advance', [['manual', 'Manuelle (je décide)'], ['auto', 'Automatique']], s.settings.advance),
        h('button', { class: 'btn btn-gold', disabled: !s.players.length, onclick: () => send('start') }, 'Lancer la partie'));
    } else {
      const g = s.game;
      const box = h('div', { class: 'box' }, h('b', { text: PHASE_LABEL[g.phase] }));
      if (g.q) box.append(h('span', { text: 'Question ' + g.q + ' sur ' + g.total }));
      if (g.phase === 'question') box.append(h('span', { text: g.answered + ' / ' + g.participants + ' ont répondu' }));
      if (g.phase === 'reveal') box.append(h('span', { text: g.reveal.rightCount + ' bonnes réponses, ' + g.reveal.wrongCount + ' erreurs' }));
      children.push(box);
      if (g.phase === 'finished') {
        children.push(h('button', { class: 'btn btn-gold', onclick: () => send('restart') }, 'Rejouer avec les mêmes joueurs'));
      } else {
        const label = { intro: 'Passer l’introduction', question: 'Révéler la réponse', reveal: g.last ? 'Voir le classement' : 'Question suivante' }[g.phase];
        children.push(h('div', { class: 'row' },
          h('button', { class: 'btn btn-gold', onclick: () => send('next') }, label),
          h('button', { class: 'btn danger', onclick: () => { if (confirm('Terminer la partie maintenant ?')) send('end'); } }, 'Terminer la partie')));
      }
    }
    app.replaceChildren(h('div', { class: 'rc' }, children));
  }

  (async function boot() {
    if (!code || !key) {
      app.replaceChildren(h('div', { class: 'welcome' }, h('h1', { text: 'Lien incomplet' }), h('p', { text: 'Sur l’écran de la TV, appuyez sur la touche H pour afficher le QR code de la télécommande, puis scannez-le.' })));
      return;
    }
    const ok = await fetch('/api/rooms/' + code + '/exists').catch(() => null);
    if (!ok || !ok.ok) {
      app.replaceChildren(h('div', { class: 'welcome' }, h('h1', { text: 'Salle introuvable' }), h('p', { text: 'La salle est terminée ou la TV a été rechargée. Réaffichez le QR code de la télécommande (touche H).' })));
      return;
    }
    stream('/api/rooms/' + code + '/stream?role=tv', {
      state: (s) => { state = s; statusEl.hidden = true; render(); },
      status: (up) => { statusEl.hidden = up; },
      gone: () => app.replaceChildren(h('div', { class: 'welcome' }, h('h1', { text: 'Salle terminée' }))),
    });
  })();
})();
