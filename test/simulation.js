'use strict';
/*
 * Simule une partie complète via l'API (sans navigateur) :
 * paliers, retombée au dernier palier (sans élimination), joker 50:50, temps écoulé, classement, rejouer.
 * Échelle à 5 questions : 100 - 300 - 1 000 (palier) - 3 000 - 10 000.
 */
const assert = require('assert');
const http = require('http');
const { start, server, rooms } = require('../server');

const PORT = 3999;
const call = (method, path, body) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: data ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : {} }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; console.log('  ✓ ' + msg); };

(async () => {
  await start(PORT);
  const { body: room } = await call('POST', '/api/rooms', { gameId: 'pepites' });
  const code = room.code;
  const host = (type, extra) => call('POST', `/api/rooms/${code}/host`, Object.assign({ key: room.hostKey, type }, extra));
  const players = [];
  for (const name of ['Alice', 'Bob', 'Chloé', 'Dylan']) {
    const r = await call('POST', `/api/rooms/${code}/join`, { name });
    players.push(Object.assign({ name }, r.body));
  }
  const [alice, bob, chloe, dylan] = players;
  const act = (p, type, data) => call('POST', `/api/rooms/${code}/act`, { pid: p.pid, token: p.token, type, data });
  const g = () => rooms.get(code).game;
  const me = (p) => g().players.get(p.pid);
  const correctIdx = () => g().questions[g().q - 1].correct;
  const wrongIdx = () => [0, 1, 2, 3].find((i) => i !== correctIdx());
  const right = (p) => act(p, 'answer', { choice: correctIdx() });
  const wrong = (p) => act(p, 'answer', { choice: wrongIdx() });
  const settle = async () => { await sleep(1500); ok(g().phase === 'reveal', 'révélation automatique : tout le monde a répondu'); };
  const state = () => players.map((p) => `${p.name} ${me(p).gain}`).join(' | ');

  console.log('Salle d’attente');
  ok((await host('start', { key: 'mauvaise' })).status === 403, 'une mauvaise clé animateur est refusée');
  ok((await act(alice, 'answer', { choice: 0 })).status === 409, 'on ne peut pas répondre avant le début');
  await host('settings', { questions: 5, timer: 15 });
  ok(rooms.get(code).settings.questions === 5 && rooms.get(code).settings.timer === 15, 'les réglages sont pris en compte');

  console.log('Question 1');
  ok(rooms.get(code).settings.advance === 'manual', 'par défaut, le passage à la question suivante est manuel');
  ok((await host('start')).status === 200, 'la partie démarre');
  ok(g().manual === true && g().timeoutId === null && g().viewTV().remainingMs === undefined, 'mode manuel : la présentation attend l’animateur (aucun minuteur automatique)');
  await host('next');
  ok(g().phase === 'question' && g().q === 1, 'question 1');
  ok(g().viewPlayer(alice.pid).correct === undefined && g().viewTV().reveal === undefined, 'la bonne réponse ne fuite pas avant la révélation');
  ok(g().viewPlayer(alice.pid).nextValue === 100, 'une bonne réponse rapportera 100 pépites');
  ok(g().viewPlayer(alice.pid).question === g().questions[0].text, 'la question est aussi envoyée aux téléphones');
  await right(alice); await right(bob); await right(chloe);
  ok((await act(alice, 'answer', { choice: 1 })).status === 400, 'on ne peut pas répondre deux fois');
  ok((await act(dylan, 'answer', { choice: 7 })).status === 400, 'un choix invalide est refusé');
  await wrong(dylan);
  await settle();
  ok(g().timeoutId === null, 'mode manuel : la réponse reste affichée tant que l’animateur n’a pas appuyé');
  ok(me(alice).gain === 100 && me(dylan).gain === 0, 'Alice a 100 pépites, Dylan 0');
  ok(me(dylan).lastResult.lost === 0, 'Dylan n’avait rien : il ne perd rien');
  ok(g().viewTV().levelCounts[1] === 3 && g().viewTV().levelCounts[0] === 1, 'la TV compte 3 joueurs au cran 1 et 1 au cran 0');
  await host('next');

  console.log('Question 2 : joker 50:50, et la preuve que personne n’est éliminé');
  ok(g().q === 2, 'question 2');
  ok((await right(dylan)).status === 200, 'Dylan, qui s’est trompé, n’est PAS éliminé : il répond à la question 2');
  ok(g().viewPlayer(dylan.pid).nextValue === 100, 'Dylan repart du bas de l’échelle (100 à gagner)');
  ok(g().viewPlayer(alice.pid).nextValue === 300, 'Alice joue pour 300');
  ok((await act(bob, 'joker')).status === 200, 'Bob utilise son joker 50:50');
  const vb = g().viewPlayer(bob.pid);
  ok(vb.hidden.length === 2 && !vb.hidden.includes(correctIdx()), 'le joker retire exactement 2 mauvaises réponses, jamais la bonne');
  ok(g().viewPlayer(alice.pid).hidden.length === 0, 'le joker ne touche que Bob');
  ok((await act(bob, 'joker')).status === 400, 'le joker ne peut pas être réutilisé');
  ok((await act(bob, 'answer', { choice: vb.hidden[0] })).status === 400, 'on ne peut pas choisir une réponse retirée');
  await right(bob); await right(alice); await wrong(chloe);
  await settle();
  ok(me(alice).gain === 300 && me(bob).gain === 300 && me(dylan).gain === 100, 'Alice 300, Bob 300, Dylan 100');
  ok(me(chloe).gain === 0 && g().viewPlayer(chloe.pid).result.lost === 1, 'Chloé, sans palier, retombe à 0 (en perdant 1 cran) mais reste en jeu');
  await host('next');

  console.log('Question 3 : palier à 1 000 pépites');
  ok(g().viewPlayer(bob.pid).jokerAvailable === false && g().viewPlayer(alice.pid).jokerAvailable === true, 'Bob n’a plus de joker, Alice si');
  ok(g().viewPlayer(alice.pid).nextValue === 1000, 'Alice joue pour 1 000');
  await right(alice); await right(bob); await right(chloe); await wrong(dylan);
  await settle();
  ok(me(alice).gain === 1000 && me(alice).secured === 1000 && me(bob).secured === 1000, 'Alice et Bob franchissent le palier : 1 000 assurés');
  ok(JSON.stringify(g().reveal.reachedPalier.sort()) === JSON.stringify(['Alice', 'Bob']), 'la TV annonce qui a franchi le palier');
  ok(me(chloe).gain === 100 && me(dylan).gain === 0, 'Chloé 100, Dylan retombe à 0');
  await host('next');

  console.log('Question 4 : on retombe… ou on garde son palier');
  await wrong(alice); await right(bob); await right(chloe);
  // Dylan ne répond pas : l'animateur force la révélation
  await sleep(300);
  await host('next');
  ok(g().phase === 'reveal', 'l’animateur peut forcer la révélation');
  ok(me(dylan).lastResult.timedOut === true, 'Dylan n’a pas répondu : temps écoulé');
  ok(me(alice).gain === 1000 && g().viewPlayer(alice.pid).result.lost === 0, 'Alice se trompe mais garde son palier de 1 000');
  ok(me(bob).gain === 3000 && me(chloe).gain === 300, 'Bob monte à 3 000, Chloé à 300');
  await host('next');

  console.log('Question 5 : dernière question');
  await right(alice); await wrong(bob); await wrong(chloe); await right(dylan);
  await settle();
  ok(me(bob).gain === 1000 && g().viewPlayer(bob.pid).result.lost === 1, 'Bob, à 3 000, retombe à son palier de 1 000 (il ne perd pas tout)');
  ok(me(chloe).gain === 0, 'Chloé retombe à 0');
  ok(g().last === true, 'c’est la dernière question');
  await host('next');
  ok(g().phase === 'finished', 'la partie se termine après la dernière question');
  const rank = g().ranking;
  console.log('   classement :', rank.map((r) => `${r.rank}. ${r.name} ${r.score}`).join(' | '));
  ok(rank[0].name === 'Alice' && rank[0].score === 3000, 'Alice gagne avec 3 000 pépites');
  ok(rank[1].name === 'Bob' && rank[1].score === 1000, 'Bob 2e avec 1 000');
  ok(rank[2].name === 'Dylan' && rank[2].score === 100, 'Dylan 3e avec 100');
  ok(rank[3].name === 'Chloé' && rank[3].score === 0, 'Chloé 4e avec 0');
  ok(g().viewPlayer(alice.pid).rank === 1 && g().viewPlayer(alice.pid).score === 3000, 'Alice voit son rang sur son téléphone');

  console.log('Rejouer');
  await host('restart');
  ok(rooms.get(code).game === null, 'retour à la salle d’attente avec les mêmes joueurs');
  await host('settings', { advance: 'auto' });
  ok(rooms.get(code).settings.advance === 'auto', 'on peut passer en enchaînement automatique');
  ok((await host('start')).status === 200 && g().manual === false && g().timeoutId !== null, 'mode automatique : un minuteur enchaîne la présentation tout seul');
  g().dispose();
  await host('restart');
  await host('settings', { advance: 'bidon', questions: 15, timer: 30 });
  ok(rooms.get(code).settings.advance === 'manual', 'une valeur invalide revient au mode manuel');
  ok((await host('start')).status === 200 && g().total === 15, 'nouvelle partie de 15 questions');
  ok(new Set(g().questions.map((q) => q.text)).size === 15, '15 questions toutes différentes');
  const tiers = g().questions.map((q) => q.tier);
  ok(tiers.every((t, i) => i === 0 || tiers[i - 1] <= t), 'la difficulté augmente au fil des questions (' + tiers.join('') + ')');
  ok(g().ladder.values.length === 15 && g().ladder.paliers.join() === '5,10', 'échelle de 15 crans, paliers aux questions 5 et 10');
  ok(tiers[14] === 6 && tiers[0] === 1, 'la première question est de niveau 1 et la dernière de niveau 6 (très difficile)');
  g().dispose();

  console.log('Enchaînement de parties dans la même salle (banque réelle)');
  const { loadBank, pickQuestions, tierForRung } = require('../jeux/pepites');
  const bank = loadBank().questions;
  ok(bank.length >= 200, 'la banque contient ' + bank.length + ' questions');
  for (const total of [5, 10, 15]) {
    const t = Array.from({ length: total }, (_, i) => tierForRung(i + 1, total));
    ok(t[0] === 1 && t[total - 1] === 6 && t.every((x, i) => i === 0 || t[i - 1] <= x), `partie de ${total} : difficulté croissante ${t.join('')}, dernière question de niveau 6`);
  }
  const used = new Set();
  const seen = new Set();
  let repeats = 0;
  let orderOk = true;
  for (let partie = 1; partie <= 12; partie++) {
    const picks = pickQuestions(bank, 15, used);
    picks.forEach((q) => { if (seen.has(q.key)) repeats++; seen.add(q.key); });
    orderOk = orderOk && picks.every((q, i) => i === 0 || picks[i - 1].level <= q.level) && picks[14].level === 6;
  }
  ok(repeats === 0 && seen.size === 180, '12 parties de 15 questions de suite dans la même salle : 180 questions toutes différentes');
  ok(orderOk, 'à chaque partie : difficulté croissante et dernière question de niveau 6');
  ok(pickQuestions(bank, 15, used).length === 15, 'la 13e partie fonctionne aussi (les questions les plus épuisées sont alors recyclées)');
  const used10 = new Set();
  const seen10 = new Set();
  let rep10 = 0;
  for (let partie = 1; partie <= 16; partie++) pickQuestions(bank, 10, used10).forEach((q) => { if (seen10.has(q.key)) rep10++; seen10.add(q.key); });
  ok(rep10 === 0 && seen10.size === 160, '16 parties de 10 questions de suite : 160 questions toutes différentes');
  const used5 = new Set();
  const seen5 = new Set();
  let rep5 = 0;
  for (let partie = 1; partie <= 16; partie++) pickQuestions(bank, 5, used5).forEach((q) => { if (seen5.has(q.key)) rep5++; seen5.add(q.key); });
  ok(rep5 === 0 && seen5.size === 80, '16 parties de 5 questions de suite : 80 questions toutes différentes');

  console.log(`\n${checks} vérifications réussies.`);
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('\n✗ ÉCHEC :', e.message);
  process.exit(1);
});
