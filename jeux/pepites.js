'use strict';
/*
 * Jeu « Qui veut gagner des pépites ? »
 * -------------------------------------
 * Tous les joueurs répondent à la même question en même temps (depuis leur téléphone).
 * Chaque joueur grimpe sa propre échelle de gains :
 *   - bonne réponse  -> il monte d'un cran ;
 *   - mauvaise réponse ou pas de réponse -> il n'est PAS éliminé : il retombe au dernier PALIER franchi
 *     (ou à zéro s'il n'en a franchi aucun) et repart de là à la question suivante ;
 *   - joker 50:50 -> 2 jokers par partie et par joueur (un seul par question), chacun retire 2 mauvaises réponses (pour lui seul).
 * La partie dure jusqu'à la dernière question. Le classement final se fait sur les pépites,
 * puis sur le nombre de bonnes réponses, puis sur la rapidité.
 */
const fs = require('fs');
const path = require('path');

const BANK_FILE = path.join(__dirname, '..', 'donnees', 'questions-pepites.json');

const JOKERS_PER_GAME = 2;

const LADDERS = {
  5: { values: [100, 300, 1000, 3000, 10000], paliers: [3] },
  10: { values: [100, 200, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000], paliers: [4, 7] },
  15: {
    values: [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000],
    paliers: [5, 10],
  },
};

const INTRO_MS = 5000; // écran de présentation avant la 1re question
const REVEAL_MS = 8000; // temps d'affichage de la bonne réponse
const EARLY_REVEAL_MS = 1200; // délai avant de révéler quand tout le monde a répondu
const GRACE_MS = 400; // tolérance réseau sur la fin du chrono

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadBank() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
  } catch (e) {
    throw new Error('Impossible de lire donnees/questions-pepites.json (' + e.message + ')');
  }
  if (!Array.isArray(raw)) throw new Error('Le fichier de questions doit contenir une liste de questions.');
  const questions = [];
  const problems = [];
  raw.forEach((item, i) => {
    const label = 'Question n°' + (i + 1);
    const text = item && typeof item.question === 'string' ? item.question.trim() : '';
    const good = item && typeof item.bonne_reponse === 'string' ? item.bonne_reponse.trim() : '';
    const wrong = item && Array.isArray(item.mauvaises_reponses) ? item.mauvaises_reponses : null;
    const level = Number(item && item.niveau);
    if (!text) return problems.push(label + ' : le texte de la question est vide.');
    if (!good) return problems.push(label + ' : la bonne réponse est vide.');
    if (!wrong || wrong.length !== 3 || wrong.some((w) => typeof w !== 'string' || !w.trim())) {
      return problems.push(label + ' : il faut exactement 3 mauvaises réponses.');
    }
    const all = [good, ...wrong].map((s) => s.trim().toLowerCase());
    if (new Set(all).size !== 4) return problems.push(label + ' : deux réponses sont identiques.');
    if (![1, 2, 3, 4, 5, 6].includes(level)) return problems.push(label + ' : le niveau doit être compris entre 1 et 6.');
    questions.push({
      key: text,
      text,
      good,
      wrong: wrong.map((w) => w.trim()),
      level,
      theme: typeof item.theme === 'string' && item.theme.trim() ? item.theme.trim() : 'culture_g',
      category: typeof item.categorie === 'string' ? item.categorie.trim() : '',
      anecdote: typeof item.anecdote === 'string' ? item.anecdote.trim() : '',
    });
  });
  return { questions, problems };
}

const MAX_TIER = 6; // niveau 6 = « très difficile »

// Courbe de difficulté : le niveau monte progressivement, et les dernières questions sont toujours difficiles
// (la toute dernière est de niveau 6).
const CURVES = {
  5: [1, 1, 2, 4, 6],
  10: [1, 1, 2, 2, 3, 4, 4, 5, 6, 6],
  15: [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6],
};

// Niveau de difficulté de la question n° `rung` (1 = première) dans une partie de `total` questions.
function tierForRung(rung, total) {
  const curve = CURVES[total];
  if (curve) return curve[Math.min(rung, total) - 1];
  if (rung >= total) return MAX_TIER;
  const c = CURVES[15];
  return c[Math.round(((rung - 1) * (c.length - 1)) / Math.max(1, total - 1))];
}

// Les thèmes « football » et « sports » comptent comme un seul groupe pour la variété.
const groupOf = (q) => (q.theme === 'football' || q.theme === 'sports' ? 'sports' : q.theme);

// Maximum de questions d'un même thème (et du groupe sport) dans une partie.
function limitsFor(total) {
  return { perTheme: total <= 5 ? 1 : 2, sports: total <= 5 ? 1 : total <= 10 ? 2 : 3 };
}

// Choisit une question par cran de la courbe de difficulté, en variant les thèmes (jamais deux questions
// du même thème d'affilée, pas plus de 2 par thème et peu de sport) et en évitant les répétitions.
// `used` mémorise les questions déjà posées dans la salle : tant qu'il reste des questions jamais posées
// à un niveau, on ne repioche pas une question déjà vue.
function pickQuestions(bank, total, used) {
  const byTier = {};
  for (let t = 1; t <= MAX_TIER; t++) byTier[t] = [];
  bank.forEach((q) => byTier[q.level].push(q));
  const picked = [];
  const pickedKeys = new Set();
  const lim = limitsFor(total);

  function pickOne(tier) {
    const prev = picked.length ? picked[picked.length - 1] : null;
    const themeCount = {};
    let sportsCount = 0;
    picked.forEach((q) => {
      themeCount[q.theme] = (themeCount[q.theme] || 0) + 1;
      if (groupOf(q) === 'sports') sportsCount++;
    });
    // Du plus strict au plus souple : on assouplit seulement si rien d'autre n'est disponible.
    const rules = [
      (q) => (themeCount[q.theme] || 0) < lim.perTheme && (groupOf(q) !== 'sports' || sportsCount < lim.sports) && !(prev && groupOf(q) === groupOf(prev)),
      (q) => (themeCount[q.theme] || 0) < lim.perTheme && (groupOf(q) !== 'sports' || sportsCount < lim.sports),
      (q) => !(prev && q.theme === prev.theme),
      () => true,
    ];
    const dist = (t) => Math.abs(t - tier);
    const sets = [
      [(t) => dist(t) === 0, 0],
      [(t) => dist(t) === 0, 1],
      [(t) => dist(t) <= 1, 0],
      [(t) => dist(t) <= 1, 1],
      [(t) => dist(t) === 0, 2],
      [(t) => dist(t) === 0, 3],
      [() => true, 2],
      [() => true, 3],
    ];
    // D'abord uniquement des questions jamais posées dans la salle ; si plus rien, on recycle.
    for (const wantFresh of [true, false]) {
      for (const [tierOk, ruleIndex] of sets) {
        const cands = [];
        for (let t = 1; t <= MAX_TIER; t++) {
          if (!tierOk(t)) continue;
          byTier[t].forEach((q) => {
            if (pickedKeys.has(q.key) || !rules[ruleIndex](q)) return;
            if (wantFresh && used.has(q.key)) return;
            cands.push(q);
          });
        }
        if (!cands.length) continue;
        // Au plus près du niveau voulu, puis on tire d'abord un thème au hasard pour équilibrer les thèmes.
        const best = Math.min(...cands.map((q) => dist(q.level)));
        const near = cands.filter((q) => dist(q.level) === best);
        const themes = [...new Set(near.map((q) => q.theme))];
        const theme = themes[Math.floor(Math.random() * themes.length)];
        const pool = near.filter((q) => q.theme === theme);
        const choice = pool[Math.floor(Math.random() * pool.length)];
        if (!wantFresh) near.forEach((q) => used.delete(q.key));
        return choice;
      }
    }
    return null;
  }

  for (let i = 1; i <= total; i++) {
    const q = pickOne(tierForRung(i, total));
    if (!q) throw new Error('Pas assez de questions dans la banque (' + bank.length + ') pour une partie de ' + total + '.');
    picked.push(q);
    pickedKeys.add(q.key);
    used.add(q.key);
  }
  return picked;
}

class PepitesGame {
  constructor(ctx, options) {
    this.ctx = ctx;
    const n = Number(options.questions);
    const t = Number(options.timer);
    this.total = [5, 10, 15].includes(n) ? n : 15;
    this.timer = [15, 20, 30, 45, 60].includes(t) ? t : 30;
    // Manuel : l'animateur passe lui-même à l'étape suivante (Espace). Automatique : le jeu enchaîne seul.
    this.manual = options.advance !== 'auto';
    this.ladder = LADDERS[this.total];
    this.phase = 'idle';
    this.players = new Map();
    this.q = 0;
    this.questions = [];
    this.timeoutId = null;
    this.earlyId = null;
    this.reveal = null;
    this.last = false;
    this.ranking = [];
  }

  start() {
    let bank;
    try {
      const loaded = loadBank();
      loaded.problems.forEach((p) => console.warn('[questions] ' + p));
      bank = loaded.questions;
      const picks = pickQuestions(bank, this.total, this.ctx.used);
      this.questions = picks.map((q) => {
        const choices = shuffle([{ t: q.good, ok: true }, ...q.wrong.map((t) => ({ t, ok: false }))]);
        return {
          text: q.text,
          choices: choices.map((c) => c.t),
          correct: choices.findIndex((c) => c.ok),
          category: q.category,
          anecdote: q.anecdote,
          tier: q.level,
        };
      });
    } catch (e) {
      return { error: e.message };
    }
    this.ctx.players().forEach((p) => {
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        level: 0, // cran actuel sur l'échelle (0 = pas encore de bonne réponse)
        securedLevel: 0, // dernier palier franchi : c'est là qu'on retombe après une erreur
        gain: 0,
        secured: 0,
        jokersLeft: JOKERS_PER_GAME,
        hidden: [],
        hiddenQ: 0,
        answer: null,
        answerMs: 0,
        correctCount: 0,
        totalMs: 0,
        finalScore: null,
        lastQ: 0,
        lastResult: null,
      });
    });
    this.phase = 'intro';
    this.introEnd = this.manual ? null : Date.now() + INTRO_MS;
    if (!this.manual) this.timeoutId = setTimeout(() => this.nextQuestion(), INTRO_MS);
    this.ctx.broadcast();
    return { ok: true };
  }

  // Plus d'élimination : tout le monde joue jusqu'à la dernière question.
  playerList() {
    return [...this.players.values()];
  }

  levelCounts() {
    const counts = new Array(this.total + 1).fill(0);
    this.players.forEach((p) => counts[p.level]++);
    return counts;
  }

  nextQuestion() {
    this.clearTimers();
    this.q++;
    this.phase = 'question';
    this.reveal = null;
    const now = Date.now();
    this.qStart = now;
    this.deadline = now + this.timer * 1000;
    this.players.forEach((p) => {
      p.answer = null;
      p.answerMs = 0;
    });
    this.timeoutId = setTimeout(() => this.doReveal(), this.timer * 1000);
    this.ctx.broadcast();
  }

  answer(pid, choice) {
    if (this.phase !== 'question') return { error: 'Trop tard : la question est terminée.' };
    const p = this.players.get(pid);
    if (!p) return { error: 'Tu ne participes pas à cette partie.' };
    if (p.answer !== null) return { error: 'Tu as déjà répondu.' };
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { error: 'Réponse invalide.' };
    if (p.hiddenQ === this.q && p.hidden.includes(idx)) return { error: 'Cette réponse a été retirée par le 50:50.' };
    const now = Date.now();
    if (now > this.deadline + GRACE_MS) return { error: 'Trop tard : la question est terminée.' };
    p.answer = idx;
    p.answerMs = Math.min(now - this.qStart, this.timer * 1000);
    this.ctx.broadcastSoon();
    const everyone = this.playerList();
    if (everyone.length && everyone.every((x) => x.answer !== null) && !this.earlyId) {
      this.earlyId = setTimeout(() => this.doReveal(), EARLY_REVEAL_MS);
    }
    return { ok: true };
  }

  useJoker(pid) {
    if (this.phase !== 'question') return { error: 'Le joker s’utilise pendant une question.' };
    const p = this.players.get(pid);
    if (!p) return { error: 'Tu ne participes pas à cette partie.' };
    if (p.jokersLeft <= 0) return { error: 'Tu as utilisé tous tes jokers.' };
    if (p.hiddenQ === this.q) return { error: 'Un seul joker par question.' };
    if (p.answer !== null) return { error: 'Tu as déjà répondu.' };
    const q = this.questions[this.q - 1];
    const wrongIdx = [0, 1, 2, 3].filter((i) => i !== q.correct);
    p.hidden = shuffle(wrongIdx).slice(0, 2).sort();
    p.hiddenQ = this.q;
    p.jokersLeft -= 1;
    this.ctx.broadcastSoon();
    return { ok: true };
  }

  doReveal() {
    if (this.phase !== 'question') return;
    this.clearTimers();
    const q = this.questions[this.q - 1];
    const distribution = [0, 0, 0, 0];
    let noAnswer = 0;
    let rightCount = 0;
    const fellBack = []; // joueurs qui perdent des pépites et retombent à leur palier
    const reachedPalier = []; // joueurs qui franchissent un palier sur cette question
    this.players.forEach((p) => {
      if (p.answer === null) noAnswer++;
      else distribution[p.answer]++;
      p.lastQ = this.q;
      const before = p.level;
      if (p.answer === q.correct) {
        rightCount++;
        p.level++;
        p.gain = this.ladder.values[p.level - 1];
        p.correctCount++;
        p.totalMs += p.answerMs;
        const palier = this.ladder.paliers.includes(p.level);
        if (palier) {
          p.secured = p.gain;
          p.securedLevel = p.level;
          reachedPalier.push(p.name);
        }
        p.lastResult = { correct: true, timedOut: false, palier, gain: p.gain, lost: 0 };
      } else {
        // Mauvaise réponse ou pas de réponse : on retombe au dernier palier franchi, sans être éliminé.
        p.level = p.securedLevel;
        p.gain = p.secured;
        if (before > p.level) fellBack.push(p.name);
        p.lastResult = { correct: false, timedOut: p.answer === null, palier: false, gain: p.gain, lost: before - p.level };
      }
    });
    this.reveal = { correct: q.correct, distribution, noAnswer, rightCount, wrongCount: this.players.size - rightCount, fellBack, reachedPalier };
    this.phase = 'reveal';
    this.last = this.q === this.total;
    this.revealEnd = this.manual ? null : Date.now() + REVEAL_MS;
    if (!this.manual) this.timeoutId = setTimeout(() => (this.last ? this.finish() : this.nextQuestion()), REVEAL_MS);
    this.ctx.broadcast();
  }

  finish() {
    this.clearTimers();
    this.players.forEach((p) => {
      p.finalScore = p.gain;
    });
    this.ranking = [...this.players.values()]
      .sort((a, b) => b.finalScore - a.finalScore || b.correctCount - a.correctCount || a.totalMs - b.totalMs)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.finalScore, reached: p.correctCount }));
    this.phase = 'finished';
    this.ctx.broadcast();
  }

  clearTimers() {
    clearTimeout(this.timeoutId);
    clearTimeout(this.earlyId);
    this.timeoutId = null;
    this.earlyId = null;
  }

  hostAction(type) {
    if (type === 'next') {
      if (this.phase === 'intro') return this.nextQuestion(), { ok: true };
      if (this.phase === 'question') return this.doReveal(), { ok: true };
      if (this.phase === 'reveal') return (this.last ? this.finish() : this.nextQuestion()), { ok: true };
      return { error: 'Rien à passer pour le moment.' };
    }
    if (type === 'end') {
      if (this.phase === 'finished') return { error: 'La partie est déjà terminée.' };
      this.finish();
      return { ok: true };
    }
    return { error: 'Action inconnue.' };
  }

  action(pid, type, data) {
    if (type === 'answer') return this.answer(pid, data && data.choice);
    if (type === 'joker') return this.useJoker(pid);
    return { error: 'Action inconnue.' };
  }

  dispose() {
    this.clearTimers();
  }

  viewTV() {
    const now = Date.now();
    const s = {
      phase: this.phase,
      q: this.q,
      total: this.total,
      timerMs: this.timer * 1000,
      ladder: this.ladder,
      participants: this.players.size,
      manual: this.manual,
    };
    if (this.phase === 'intro' && !this.manual) s.remainingMs = Math.max(0, this.introEnd - now);
    if (this.phase === 'question' || this.phase === 'reveal') {
      const q = this.questions[this.q - 1];
      s.levelCounts = this.levelCounts(); // nombre de joueurs à chaque cran de l'échelle
      s.question = { text: q.text, choices: q.choices, category: q.category, tier: q.tier };
      s.answered = this.playerList().filter((p) => p.answer !== null).length;
      if (this.phase === 'question') s.remainingMs = Math.max(0, this.deadline - now);
      if (this.phase === 'reveal') {
        s.reveal = Object.assign({}, this.reveal, { anecdote: q.anecdote });
        s.last = this.last;
      }
    }
    if (this.phase === 'finished') s.ranking = this.ranking.slice(0, 10);
    return s;
  }

  viewPlayer(pid) {
    const now = Date.now();
    const p = this.players.get(pid);
    const s = {
      phase: this.phase,
      q: this.q,
      total: this.total,
      timerMs: this.timer * 1000,
      status: p ? 'playing' : 'spectator',
      participants: this.players.size,
      manual: this.manual,
    };
    if (p) {
      s.gain = p.gain; // pépites actuellement en jeu
      s.secured = p.secured; // pépites assurées par le dernier palier
      s.jokersLeft = p.jokersLeft;
      s.jokersTotal = JOKERS_PER_GAME;
    }
    if (this.phase === 'intro' && !this.manual) s.remainingMs = Math.max(0, this.introEnd - now);
    if (this.phase === 'question' || this.phase === 'reveal') {
      const q = this.questions[this.q - 1];
      // Ce que rapporte une bonne réponse à CE joueur (dépend de son propre cran, pas du numéro de question).
      if (p && this.phase === 'question') s.nextValue = this.ladder.values[p.level];
      s.question = q.text;
      s.category = q.category;
      s.choices = q.choices;
      s.hidden = p && p.hiddenQ === this.q ? p.hidden : [];
      if (p) s.myAnswer = p.answer;
      if (this.phase === 'question') {
        s.remainingMs = Math.max(0, this.deadline - now);
        s.jokerAvailable = !!(p && p.jokersLeft > 0 && p.hiddenQ !== this.q && p.answer === null);
      } else {
        s.correct = q.correct;
        s.result = p && p.lastQ === this.q ? p.lastResult : null;
        s.last = this.last;
      }
    }
    if (this.phase === 'finished') {
      s.ranking = this.ranking.slice(0, 5);
      const mine = this.ranking.find((r) => r.id === pid);
      if (mine) {
        s.rank = mine.rank;
        s.score = mine.score;
      }
    }
    return s;
  }
}

module.exports = {
  id: 'pepites',
  name: 'Qui veut gagner des pépites ?',
  defaults: { questions: 15, timer: 30, advance: 'manual' },
  sanitizeSettings(input) {
    const n = Number(input && input.questions);
    const t = Number(input && input.timer);
    return {
      questions: [5, 10, 15].includes(n) ? n : 15,
      timer: [15, 20, 30, 45, 60].includes(t) ? t : 30,
      advance: input && input.advance === 'auto' ? 'auto' : 'manual',
    };
  },
  create(ctx, options) {
    return new PepitesGame(ctx, options);
  },
  loadBank,
  pickQuestions,
  tierForRung,
};
