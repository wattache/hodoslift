#!/usr/bin/env bash
# La stack e2e RÉELLE en un geste : émulateur Auth + comptes + brokkr-e2e + specs.
#
#   ./scripts/e2e-reel.sh              # monte ce qui manque, joue toutes les specs
#   ./scripts/e2e-reel.sh athlete      # idem, en filtrant (arguments → Playwright)
#   ./scripts/e2e-reel.sh --arret      # éteint ce que ce script a pu démarrer
#
# ⚠️ IL VIT À LA RACINE, PLUS DANS `eitri` (FRE-61). Il montait une stack faite
# de DEUX dossiers — les seeds venaient de brokkr, le bac à sable n'appartenait à
# personne — depuis un script invité chez le troisième. Toucher au schéma brokkr
# pouvait casser le harnais d'eitri sans que rien ne le signale.
#
# Les SPECS, elles, restent dans `eitri/e2e-reel/` : ce sont des tests du front,
# et c'est Playwright (config d'eitri) qui les joue.
#
# Chaque service n'est démarré QUE s'il ne tourne pas déjà : relancer le script
# au milieu d'une session de travail ne casse rien, et le premier lancement à
# froid monte tout. Les seeds sont idempotents, ils se rejouent à chaque fois.
#
# ⚠️ Deux pièges connus, encodés ici plutôt que dans une doc :
#   - `firebase emulators:start` SORT EN CODE 0 même quand le port est pris —
#     on teste donc le port avant, et la DISPONIBILITÉ après, jamais son code ;
#   - tout tourne sur le BAC À SABLE (ff-training, port 55433). Si le conteneur
#     ne répond pas, on s'arrête net plutôt que de laisser uvicorn accumuler
#     des erreurs de connexion.
#
# ⚠️ `--reload` N'EST PAS UN CONFORT. Sans lui, brokkr-e2e servait le code de son
# DÉMARRAGE : relancer le script après un correctif serveur réutilisait le
# processus déjà debout, et la spec validait la version d'avant. Rencontré le
# 17/08 — un correctif passe alors pour vérifié sans l'être, ce qui est pire que
# pas de test du tout. `--reload-dir app` limite la surveillance au code
# applicatif : les .pyc et le venv déclencheraient des rechargements en boucle.

set -euo pipefail

FORGE="$(cd "$(dirname "$0")/.." && pwd)"        # la racine du monorepo
EITRI="$FORGE/web"
BROKKR="$FORGE/api-python"
EMULATEUR="127.0.0.1:9099"
PORT_BROKKR=8082
LOGS="${TMPDIR:-/tmp}/e2e-reel"
mkdir -p "$LOGS"

ecoute() { lsof -t -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if [ "${1:-}" = "--arret" ]; then
  for port in 9099 "$PORT_BROKKR"; do
    pid=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pid" ] && kill $pid && echo "· port $port arrêté (pid $pid)"
  done
  exit 0
fi

# ── 0. le bac à sable répond, sinon rien n'a de sens ─────────────────────────
docker exec ff-training pg_isready -U postgres -d ff >/dev/null \
  || { echo "⛔ le conteneur ff-training (port 55433) ne répond pas."; exit 1; }

# ── 0 bis. LE BAC À SABLE DÉRIVE, ET IL LE DIRA (FRE-133) ────────────────────
#
# ⚠️ CE HARNAIS A DÉJÀ MENTI DEUX FOIS, faute de ce contrôle. Le 06/09, 34 specs
#    échouaient sur un `archive_le` absent ; le 07/09, une spec rendait 500 sur
#    deux fonctions de FRE-136 jamais appliquées ici. À chaque fois le diagnostic
#    a coûté plus cher que le correctif — parce qu'on cherchait dans le CODE ce
#    qui manquait dans la BASE.
#
#    Le 08/09, le contrôle a trouvé du premier coup ce que personne ne savait :
#    le bac à sable était en retard de DEUX migrations (`sets_prevus` et
#    `tonnage_prevu_kg` absents), donc toutes les exécutions précédentes se
#    faisaient sur un schéma qui n'était pas celui de la production.
#
# ⚠️ UN REFUS, PLUS UN AVERTISSEMENT (FRE-176). Il avertissait à cause de deux
#    reliquats du basculement (`training_sets_old`, `training_sets_v`), disparus
#    depuis. Et un avertissement ne se lit pas : le 12/09, le bac à sable
#    annonçait 61 migrations sur 61 sans `ff_series_tenues`, et le 18/09 il
#    portait le lot 5 sous DEUX noms (l'ancien, joué pendant les essais, et le
#    nouveau) — les deux affichés, aucun arrêté. On compare donc les OBJETS
#    (`--strict` : Docker est déjà exigé plus haut), puis le registre, et le
#    moindre écart arrête la campagne avant la première spec.
echo "· schéma du bac à sable…"
BAC="postgresql+psycopg://postgres:local@localhost:55433/ff"
if ! (cd "$BROKKR" && DATABASE_URL="$BAC" uv run python scripts/verifier_schema.py --strict 2>&1 | sed 's/^/  /'); then
  echo "⛔ le bac à sable ne correspond pas à docs/postgres-schema.sql — rien n'est joué."
  exit 1
fi
if ! (cd "$BROKKR" && DATABASE_URL="$BAC" uv run python -m scripts.migrer 2>&1 | sed 's/^/  /'); then
  echo "⛔ le registre des migrations du bac à sable n'est pas celui du dépôt — rien n'est joué."
  echo "   Le détail est au-dessus. Une migration en attente se joue avec :"
  echo "   cd api-python && DATABASE_URL=$BAC uv run python -m scripts.migrer --apply"
  exit 1
fi

# ── 1. l'émulateur d'authentification ────────────────────────────────────────
if ecoute 9099; then
  echo "· émulateur Auth déjà sur $EMULATEUR"
else
  echo "· démarrage de l'émulateur Auth…"
  (cd "$EITRI" && nohup npx firebase emulators:start --only auth \
      --project french-forge-600 >"$LOGS/emulateur.log" 2>&1 &)
fi
for i in $(seq 1 40); do
  curl -sf "http://$EMULATEUR/" >/dev/null && break
  [ "$i" = 40 ] && { echo "⛔ l'émulateur ne répond pas ($LOGS/emulateur.log)"; exit 1; }
  sleep 0.5
done

# ── 2. les comptes et le terrain de jeu (idempotents) ────────────────────────
(cd "$BROKKR" && FIREBASE_AUTH_EMULATOR_HOST="$EMULATEUR" \
    GOOGLE_CLOUD_PROJECT=french-forge-600 uv run python "$FORGE/seeds/e2e_auth.py")
docker exec -i ff-training psql -v ON_ERROR_STOP=1 -U postgres -d ff \
  < "$FORGE/seeds/e2e.sql" >/dev/null
echo "· comptes et terrain de jeu semés"

# ── 3. brokkr sur le bac à sable, branché sur l'émulateur ────────────────────
#
# ⚠️ UN SERVEUR DÉJÀ DEBOUT PEUT SERVIR DU CODE PÉRIMÉ, et le harnais a menti
#    une troisième fois pour ça (26/09) : brokkr-e2e tournait depuis deux jours,
#    `--reload` n'avait rien rechargé, `/openapi.json` servait l'ancien contrat,
#    et une spec rougissait en 422 sur un code que `make test` disait vert.
#    Le repère `brokkr-e2e.demarre` date le dernier démarrage : un fichier de
#    `brokkr/app` plus récent que lui, et on REDÉMARRE au lieu de garder.
# ⚠️ DES CLÉS VAPID FACTICES, ET C'EST VOULU (28/09) : sans elles brokkr ne
#    propose pas les notifications push, et la spec qui éprouve l'abonnement ne
#    trouve pas son interrupteur. Aucun envoi ne part d'ici — l'endpoint des
#    specs est un faux, le refus se journalise, la génération n'en sait rien.
REPERE="$LOGS/brokkr-e2e.demarre"
if ecoute "$PORT_BROKKR"; then
  if [ ! -f "$REPERE" ] || [ -n "$(find "$BROKKR/app" -type f -name '*.py' -newer "$REPERE" | head -1)" ]; then
    pid=$(lsof -t -iTCP:"$PORT_BROKKR" -sTCP:LISTEN 2>/dev/null || true)
    echo "· brokkr-e2e sur :$PORT_BROKKR est PÉRIMÉ (api-python/app a changé depuis son démarrage) — redémarrage (pid $pid)"
    [ -n "$pid" ] && kill $pid
    for i in $(seq 1 20); do ecoute "$PORT_BROKKR" || break; sleep 0.5; done
  else
    echo "· brokkr-e2e déjà sur :$PORT_BROKKR"
  fi
fi
if ! ecoute "$PORT_BROKKR"; then
  echo "· démarrage de brokkr-e2e sur :${PORT_BROKKR}…"
  touch "$REPERE"
  (cd "$BROKKR" && \
    DATABASE_URL="postgresql://postgres:local@localhost:55433/ff" \
    FIREBASE_AUTH_EMULATOR_HOST="$EMULATEUR" \
    GOOGLE_CLOUD_PROJECT="french-forge-600" \
    GOOGLE_APPLICATION_CREDENTIALS=.secrets/brokkr-sa.json \
    VAPID_PRIVATE_KEY="cle-privee-du-harnais" VAPID_PUBLIC_KEY="cle-publique-du-harnais" \
    nohup uv run uvicorn app.main:app --port "$PORT_BROKKR" --reload --reload-dir app \
      >"$LOGS/brokkr-e2e.log" 2>&1 &)
fi
for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT_BROKKR/health" >/dev/null && break
  [ "$i" = 40 ] && { echo "⛔ brokkr-e2e ne répond pas ($LOGS/brokkr-e2e.log)"; exit 1; }
  sleep 0.5
done

# ── 4. les specs (Playwright monte Vite lui-même, sur 5200) ──────────────────
cd "$EITRI"
exec npx playwright test --config playwright.reel.config.ts "$@"
