/*
 * Affichage du jeu « Qui veut gagner des pépites ? »
 *   GameViews.pepites.tv(root, state, ctx)      -> écran de la TV
 *   GameViews.pepites.player(root, state, ctx)  -> téléphone du joueur
 * `state` est ce que le serveur envoie (voir jeux/pepites.js, viewTV / viewPlayer).
 */
(function () {
  'use strict';
  const { h, fmt, loop } = Socle;
  const LETTERS = ['A', 'B', 'C', 'D'];

  function startLoop(root) {
    if (!root._stopLoop) root._stopLoop = loop((now) => root._tick && root._tick(now));
  }

  const plural = (n, one, many) => (n > 1 ? many : one);

  /* =====================================================================
   *  TV
   * ===================================================================== */

  function ladderList(s) {
    const items = [];
    s.ladder.values.forEach((value, i) => {
      const level = i + 1;
      items.push(
        h('li', { 'data-level': level, class: s.ladder.paliers.includes(level) ? 'palier' : '' },
          h('span', { class: 'lv', text: level }),
          h('span', { class: 'val', text: fmt(value) }),
          h('span', { class: 'mark', text: s.ladder.paliers.includes(level) ? '◆' : '' }),
          h('span', { class: 'cnt' }))
      );
    });
    return h('ol', { class: 'ladder', 'aria-label': 'Échelle des gains' }, items.reverse());
  }

  function buildIntro(s) {
    const refs = { count: h('div', { class: 'intro-count' }) };
    const paliers = s.ladder.paliers.map((l) => fmt(s.ladder.values[l - 1]));
    refs.el = h('div', { class: 'intro', 'data-phase': 'intro' },
      h('img', { src: '/logo-pepites.webp', alt: 'Qui veut gagner des pépites ?', class: 'intro-logo' }),
      h('ul', { class: 'rules' },
        h('li', { text: s.total + ' questions, de plus en plus difficiles' }),
        h('li', { text: 'Une erreur ne vous élimine pas : vous retombez au dernier palier franchi (' + paliers.join(' puis ') + ' pépites) et vous repartez de là' }),
        h('li', { text: 'Deux jokers 50:50 par joueur (un par question), à utiliser sur votre téléphone' })),
      refs.count);
    return refs;
  }

  function updateIntro(root, s) {
    if (s.manual) {
      // L'animateur décide du moment de lancer la première question.
      root._tick = null;
      root._refs.count.textContent = 'Prêts ?';
      return;
    }
    const deadline = Date.now() + s.remainingMs;
    root._tick = (now) => {
      const n = Math.max(0, Math.ceil((deadline - now) / 1000));
      root._refs.count.textContent = n > 0 ? n : 'Go !';
    };
  }

  function buildQuestion(s) {
    const refs = {};
    refs.step = h('span', { class: 'chip' });
    refs.cat = h('span', { class: 'chip ghost' });
    refs.count = h('span', { class: 'count' });
    refs.bar = h('div', { class: 'bar' });
    refs.secs = h('span', { class: 'secs' });
    refs.timer = h('div', { class: 'pq-timer' }, refs.secs, h('div', { class: 'track' }, refs.bar));
    refs.text = h('div', { class: 'question' });
    refs.ans = LETTERS.map((letter) => {
      const fill = h('i', { class: 'fill' });
      const txt = h('span', { class: 'txt' });
      const pct = h('em', { class: 'pct' });
      return { el: h('div', { class: 'ans' }, fill, h('span', { class: 'letter', text: letter }), txt, pct), fill, txt, pct };
    });
    refs.foot = h('div', { class: 'pq-foot' });
    refs.ladder = ladderList(s);
    refs.el = h('div', { class: 'pq' },
      h('div', { class: 'pq-main' },
        h('div', { class: 'pq-top' }, refs.step, refs.cat, refs.count),
        refs.timer,
        refs.text,
        h('div', { class: 'pq-answers' }, refs.ans.map((a) => a.el)),
        refs.foot),
      h('aside', { class: 'pq-side' }, refs.ladder));
    return refs;
  }

  function updateQuestion(root, s) {
    const r = root._refs;
    r.el.dataset.phase = s.phase;
    r.step.textContent = 'Question ' + s.q + ' sur ' + s.total;
    r.cat.textContent = s.question.category;
    r.cat.hidden = !s.question.category;
    r.text.textContent = s.question.text;
    r.text.classList.toggle('long', s.question.text.length > 95);
    r.ans.forEach((a, i) => (a.txt.textContent = s.question.choices[i]));

    // L'échelle montre où en sont les joueurs : le nombre de personnes à chaque cran.
    r.ladder.querySelectorAll('li').forEach((li) => {
      const n = s.levelCounts[Number(li.dataset.level)] || 0;
      li.querySelector('.cnt').textContent = n ? n : '';
      li.classList.toggle('occupied', n > 0);
    });

    if (s.phase === 'question') {
      const deadline = Date.now() + s.remainingMs;
      r.count.textContent = s.answered + ' / ' + s.participants + ' ont répondu';
      r.timer.classList.remove('done');
      r.ans.forEach((a) => {
        a.el.classList.remove('correct', 'wrong');
        a.fill.style.width = '0';
        a.pct.textContent = '';
      });
      r.foot.replaceChildren(h('span', { class: 'hint', text: 'Répondez depuis votre téléphone' }));
      root._tick = (now) => {
        const left = Math.max(0, deadline - now);
        r.bar.style.transform = 'scaleX(' + (left / s.timerMs).toFixed(4) + ')';
        const secs = Math.ceil(left / 1000);
        r.secs.textContent = secs;
        r.timer.classList.toggle('urgent', secs <= 5);
      };
    } else {
      const rv = s.reveal;
      const total = rv.distribution.reduce((a, b) => a + b, 0) + rv.noAnswer;
      root._tick = null;
      r.timer.classList.add('done');
      r.timer.classList.remove('urgent');
      r.secs.textContent = '';
      r.count.textContent = '';
      r.ans.forEach((a, i) => {
        a.el.classList.toggle('correct', i === rv.correct);
        a.el.classList.toggle('wrong', i !== rv.correct);
        const p = total ? Math.round((rv.distribution[i] / total) * 100) : 0;
        a.fill.style.width = p + '%';
        a.pct.textContent = total ? p + ' %' : '';
      });
      const names = (list) => {
        const more = list.length > 6 ? ' et ' + (list.length - 6) + ' autres' : '';
        return list.slice(0, 6).join(', ') + more;
      };
      const lines = [];
      if (rv.reachedPalier.length) lines.push(h('div', { class: 'foot-palier', text: '◆ Palier franchi : ' + names(rv.reachedPalier) }));
      if (rv.fellBack.length) {
        lines.push(h('div', { class: 'foot-out', text: rv.fellBack.length + ' ' + plural(rv.fellBack.length, 'joueur retombe', 'joueurs retombent') + ' à leur palier : ' + names(rv.fellBack) }));
      } else if (rv.wrongCount === 0) {
        lines.push(h('div', { class: 'foot-ok', text: 'Sans faute : tout le monde a bon !' }));
      }
      lines.push(h('div', { class: 'foot-alive', text: rv.rightCount + ' ' + plural(rv.rightCount, 'bonne réponse', 'bonnes réponses') + ' sur ' + s.participants }));
      if (rv.anecdote) lines.push(h('div', { class: 'foot-note', text: rv.anecdote }));
      r.foot.replaceChildren(...lines);
    }
  }

  function buildFinished(s) {
    const refs = {};
    const top = s.ranking;
    const best = top[0];
    const headline = best && best.score > 0
      ? best.name + ' repart avec ' + fmt(best.score) + ' pépites'
      : 'Personne n’a décroché de pépite cette fois';
    const podium = top.slice(0, 3).map((p, i) =>
      h('li', { class: 'pod pod-' + (i + 1) },
        h('span', { class: 'pod-rank', text: i + 1 }),
        h('span', { class: 'pod-name', text: p.name }),
        h('span', { class: 'pod-score', text: fmt(p.score) + ' pépites' })));
    const rest = top.slice(3).map((p) =>
      h('li', null, h('span', { class: 'rk', text: p.rank }), h('span', { class: 'nm', text: p.name }), h('span', { class: 'sc', text: fmt(p.score) })));
    refs.el = h('div', { class: 'fin', 'data-phase': 'finished' },
      h('img', { class: 'fin-logo', src: '/logo-pepites.webp', alt: 'Qui veut gagner des pépites ?' }),
      h('h1', { text: 'Partie terminée' }),
      h('p', { class: 'winner', text: headline }),
      h('ol', { class: 'podium' }, podium),
      rest.length ? h('ol', { class: 'rest', start: 4 }, rest) : null);
    return refs;
  }

  function tv(root, s) {
    startLoop(root);
    // On ne reconstruit l'écran que lorsque la scène change ; sinon on met à jour les éléments existants.
    const key = s.phase === 'question' || s.phase === 'reveal' ? 'q' + s.q : s.phase === 'intro' ? 'intro' : 'finished:' + s.ranking.map((r) => r.id + r.score).join();
    if (root._key !== key) {
      root._key = key;
      root._tick = null;
      root._refs = s.phase === 'intro' ? buildIntro(s) : s.phase === 'finished' ? buildFinished(s) : buildQuestion(s);
      root.replaceChildren(root._refs.el);
    }
    if (s.phase === 'intro') updateIntro(root, s);
    else if (s.phase !== 'finished') updateQuestion(root, s);
    else root._tick = null;
  }

  /* =====================================================================
   *  TÉLÉPHONE
   * ===================================================================== */

  function player(root, s, ctx) {
    startLoop(root);
    // Personne n'est éliminé : seuls ceux arrivés en cours de partie sont simples spectateurs.
    s.playing = s.status === 'playing';
    const key = [s.phase, s.q, s.playing ? 'play' : s.status, s.phase === 'reveal' ? 'r' : ''].join(':');
    if (root._key !== key) {
      root._key = key;
      root._tick = null;
      root._pending = null;
      root._refs = buildPlayer(s, ctx, root);
      root.replaceChildren(root._refs.el);
    }
    updatePlayer(root, s);
  }

  function msgScreen(cls, title, lines) {
    return { el: h('div', { class: 'pp pp-msg ' + cls }, h('h2', { text: title }), (lines || []).map((t) => h('p', { text: t }))) };
  }

  function buildPlayer(s, ctx, root) {
    if (s.phase === 'intro') {
      const refs = msgScreen('pp-intro', 'Prépare-toi !', [s.manual ? 'La partie va bientôt commencer. Regarde l’écran.' : 'La partie commence dans quelques secondes. Regarde l’écran.']);
      refs.count = h('div', { class: 'pp-count' });
      refs.el.append(refs.count);
      return refs;
    }
    if (s.phase === 'finished') return buildPlayerFinished(s);

    const header = (refs) => {
      refs.step = h('span', { class: 'pp-step', text: 'Question ' + s.q + '/' + s.total });
      refs.val = h('span', { class: 'pp-val' });
      return h('header', { class: 'pp-top' }, refs.step, refs.val);
    };

    if (!s.playing) {
      return msgScreen('pp-out', 'Partie en cours', [
        'Tu rejoindras la prochaine partie.',
        'Question ' + s.q + '/' + s.total + ' : regarde l’écran pour suivre.',
      ]);
    }

    const refs = {};
    refs.answers = LETTERS.map((letter, i) => {
      const txt = h('span', { class: 'pa-txt' });
      const btn = h('button', { class: 'pa', type: 'button', 'data-i': i, onclick: () => choose(i) }, h('span', { class: 'pa-l', text: letter }), txt);
      return { btn, txt };
    });
    refs.timerBar = h('div', { class: 'bar' });
    refs.joker = h('button', { class: 'joker', type: 'button', onclick: () => useJoker() }, h('b', { text: '50:50 ×2' }), h('span', { text: 'Retire 2 réponses' }));
    refs.msg = h('div', { class: 'pp-note', role: 'status' });
    refs.banner = h('div', { class: 'pp-banner', hidden: true });
    refs.question = h('div', { class: 'pp-question' });

    function choose(i) {
      if (root._pending != null || (root._state && root._state.myAnswer != null)) return;
      root._pending = i;
      if (navigator.vibrate) navigator.vibrate(25);
      updatePlayer(root, root._state);
      ctx.act('answer', { choice: i }).catch((e) => { root._pending = null; Socle.toast(e.message); updatePlayer(root, root._state); });
    }
    function useJoker() {
      if (navigator.vibrate) navigator.vibrate(25);
      ctx.act('joker').catch((e) => Socle.toast(e.message));
    }

    refs.el = h('div', { class: 'pp' },
      header(refs),
      h('div', { class: 'pp-timer' }, refs.timerBar),
      refs.question,
      refs.banner,
      h('div', { class: 'pp-answers' }, refs.answers.map((a) => a.btn)),
      h('footer', { class: 'pp-foot' }, refs.joker, refs.msg));
    return refs;
  }

  function updatePlayer(root, s) {
    root._state = s;
    const r = root._refs;
    if (s.phase === 'intro') {
      if (s.manual) { root._tick = null; r.count.textContent = '…'; return; }
      const deadline = Date.now() + s.remainingMs;
      root._tick = (now) => { r.count.textContent = Math.max(0, Math.ceil((deadline - now) / 1000)) || 'Go !'; };
      return;
    }
    if (s.phase === 'finished' || !r.answers) return;

    const mine = s.myAnswer != null ? s.myAnswer : root._pending;
    const hidden = s.hidden || [];
    r.question.textContent = s.question;
    r.question.classList.toggle('long', s.question.length > 90);
    r.answers.forEach((a, i) => {
      a.txt.textContent = s.choices[i];
      a.btn.classList.toggle('gone', hidden.includes(i));
      a.btn.classList.toggle('sel', mine === i);
      a.btn.disabled = s.phase === 'reveal' || hidden.includes(i) || mine != null;
      if (s.phase === 'reveal') {
        a.btn.classList.toggle('correct', i === s.correct);
        a.btn.classList.toggle('wrong', i === mine && i !== s.correct);
        a.btn.classList.toggle('dim', i !== s.correct && i !== mine);
      }
    });

    if (s.phase === 'question') {
      const deadline = Date.now() + s.remainingMs;
      r.joker.disabled = !s.jokerAvailable || mine != null;
      const left = s.jokersLeft == null ? 0 : s.jokersLeft;
      r.joker.classList.toggle('used', left <= 0);
      r.joker.querySelector('b').textContent = '50:50 ×' + left;
      r.joker.querySelector('span').textContent = left <= 0 ? 'Plus de joker' : (s.hidden && s.hidden.length ? 'Un seul par question' : 'Retire 2 réponses');
      r.val.textContent = 'Pour ' + fmt(s.nextValue) + ' pépites';
      r.msg.textContent = mine != null
        ? 'Réponse envoyée. Regarde l’écran !'
        : 'En jeu : ' + fmt(s.gain) + ' · Palier : ' + fmt(s.secured);
      root._tick = (now) => {
        const left = Math.max(0, deadline - now);
        r.timerBar.style.transform = 'scaleX(' + (left / s.timerMs).toFixed(4) + ')';
        r.timerBar.parentNode.classList.toggle('urgent', left <= 5000);
      };
    } else {
      root._tick = null;
      r.timerBar.style.transform = 'scaleX(0)';
      r.joker.disabled = true;
      const leftR = s.jokersLeft == null ? 0 : s.jokersLeft;
      r.joker.classList.toggle('used', leftR <= 0);
      r.joker.querySelector('b').textContent = '50:50 ×' + leftR;
      r.joker.querySelector('span').textContent = leftR <= 0 ? 'Plus de joker' : (leftR === 1 ? 'Encore 1 joker' : 'Encore ' + leftR + ' jokers');
      r.val.textContent = fmt(s.gain) + ' en jeu';
      const res = s.result;
      r.banner.hidden = !res;
      r.banner.className = 'pp-banner ' + (res ? (res.correct ? 'win' : 'lose') : '');
      if (res) {
        if (res.correct) {
          r.banner.replaceChildren(h('b', { text: 'Bonne réponse !' }), h('span', { text: res.palier ? 'Palier franchi : ' + fmt(res.gain) + ' pépites assurées' : 'Tu as ' + fmt(res.gain) + ' pépites en jeu' }));
        } else {
          const title = res.timedOut ? 'Temps écoulé' : 'Raté…';
          const detail = res.lost > 0
            ? 'Tu retombes à ton palier : ' + fmt(res.gain) + ' pépites. Tu repars de là !'
            : res.gain > 0 ? 'Tu gardes ton palier : ' + fmt(res.gain) + ' pépites.' : 'Tu repars de zéro, tout reste possible !';
          r.banner.replaceChildren(h('b', { text: title }), h('span', { text: detail }));
        }
      }
      r.msg.textContent = s.last
        ? 'Le classement arrive…'
        : s.manual ? 'En attente de l’animateur…' : 'Prochaine question dans un instant';
    }
  }

  function buildPlayerFinished(s) {
    const refs = {};
    const mine = s.rank != null;
    const rows = s.ranking.map((p) => h('li', null, h('span', { class: 'rk', text: p.rank }), h('span', { class: 'nm', text: p.name }), h('span', { class: 'sc', text: fmt(p.score) })));
    refs.el = h('div', { class: 'pp pp-fin' },
      h('h2', { text: 'Partie terminée' }),
      mine ? h('div', { class: 'pp-rank' }, h('b', { text: s.rank + (s.rank === 1 ? 'er' : 'e') }), h('span', { text: 'sur ' + s.participants + ' ' + plural(s.participants, 'joueur', 'joueurs') })) : null,
      mine ? h('p', { class: 'pp-final', text: fmt(s.score) + ' pépites' }) : h('p', { text: 'Merci d’avoir regardé !' }),
      h('ol', { class: 'pp-top5' }, rows));
    return refs;
  }

  GameViews.pepites = { tv, player };
})();
