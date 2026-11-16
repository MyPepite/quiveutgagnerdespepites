#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo " Node.js n'est pas installé. Téléchargez-le sur https://nodejs.org puis relancez ce fichier."
  echo ""
  read -n 1 -s -r -p "Appuyez sur une touche pour fermer…"
  exit 1
fi
node server.js
