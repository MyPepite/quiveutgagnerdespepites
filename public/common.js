/* Outils communs à la TV, aux téléphones et à la télécommande */
(function (root) {
  'use strict';

  // Crée un élément : h('div', {class: 'x', text: 'salut'}, enfant1, enfant2)
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // 1250000 -> "1 250 000" (espaces insécables)
  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ');

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* réponse vide */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Erreur réseau (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Flux temps réel avec reconnexion automatique
  function stream(url, handlers) {
    let es = null;
    let closed = false;
    function open() {
      es = new EventSource(url);
      es.addEventListener('state', (e) => handlers.state(JSON.parse(e.data)));
      es.addEventListener('gone', () => handlers.gone && handlers.gone());
      es.onopen = () => handlers.status && handlers.status(true);
      es.onerror = () => {
        handlers.status && handlers.status(false);
        // Si le serveur a refusé (salle disparue), le navigateur ferme le flux : on prévient.
        if (es.readyState === 2 && !closed) handlers.gone && handlers.gone();
      };
    }
    open();
    return { close() { closed = true; es && es.close(); } };
  }

  function toast(message) {
    let box = document.getElementById('toast');
    if (!box) {
      box = h('div', { id: 'toast', role: 'status' });
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => box.classList.remove('show'), 3500);
  }

  // Boucle d'animation légère pour les chronos
  function loop(fn) {
    let stopped = false;
    (function frame() {
      if (stopped) return;
      fn(Date.now());
      requestAnimationFrame(frame);
    })();
    return () => { stopped = true; };
  }

  root.Socle = { h, fmt, api, stream, toast, loop };
  root.GameViews = root.GameViews || {};
})(window);
