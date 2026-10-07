#!/usr/bin/env bash
# Recopie la base Neon (la production) dans la base Postgres managée de Scaleway.
#
#   ./scripts/copier_la_base_vers_scaleway.sh            # base Scaleway VIDE seulement
#   ./scripts/copier_la_base_vers_scaleway.sh --ecraser  # remplace ce qu'elle porte
#
# ⚠️ NEON N'EST OUVERT QU'EN LECTURE : `pg_dump`, rien d'autre.
#
# ⚠️ SANS `--ecraser`, UNE BASE SCALEWAY QUI PORTE DÉJÀ DES TABLES EST REFUSÉE. Une
# fois qu'elle sert les athlètes (`base_scaleway = "scaleway"`), la recopier
# effacerait tout ce qui y a été écrit depuis. `--ecraser` se tape exprès, pour
# la répétition générale ou la recopie finale, quand les écritures sont gelées.
#
# Ce que le script fait, dans l'ordre :
#   1. les adresses viennent de `terraform output`, les mots de passe de
#      Secret Manager — jamais d'une copie à la main ;
#   2. dump de Neon au format personnalisé, dans un fichier temporaire ;
#   3. restauration par le PROPRIÉTAIRE `brokkr`, SANS les propriétaires du dump :
#      Neon en a d'internes (`neon_superuser`…), absents ici, et tout objet doit
#      appartenir à `brokkr`. Les DROITS, eux, suivent : ceux de `brokkr_app`
#      arrivent tels quels ;
#   4. les bornes de session posées sur `brokkr_app` (`ALTER ROLE … SET`) — un
#      dump n'emporte pas les réglages des rôles ;
#   5. la preuve : table par table, le même nombre de lignes des deux côtés ; les
#      mêmes droits de `brokkr_app` sur chaque table ; et ses bornes relues sur
#      une connexion neuve ;
#   6. le dump s'efface : il porte des données de santé.
#
# Les clients Postgres viennent de l'image `postgres:16` (la version de Neon et
# de la base Scaleway) : rien à installer sur le poste.

set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
TF="terraform -chdir=${RACINE}/infra"
ECRASER=0
[ "${1:-}" = "--ecraser" ] && ECRASER=1

# `SOURCE`, `CIBLE`, `APPLI` se surchargent pour éprouver le script sur des bases
# locales ; sans eux, ce sont les vraies. Les mots de passe de Scaleway n'ont
# que des caractères sûrs dans une URL (`scaleway_postgres.tf`).
secret() {
  CLOUDSDK_CORE_ACCOUNT=attachew974@gmail.com \
    gcloud secrets versions access latest --project=french-forge-600 --secret="$1"
}
if [ -z "${CIBLE:-}" ] || [ -z "${APPLI:-}" ]; then
  BASE="$(${TF} output -raw scaleway_postgres_endpoint)/hodos?sslmode=require"
fi
SOURCE="${SOURCE:-$(${TF} output -raw neon_migration_uri)}"
CIBLE="${CIBLE:-postgresql://brokkr:$(secret hodos-db-password)@${BASE}}"
APPLI="${APPLI:-postgresql://brokkr_app:$(secret hodos-app-db-password)@${BASE}}"
PG="docker run --rm -i --add-host=host.docker.internal:host-gateway -e PGCONNECT_TIMEOUT=20 postgres:16"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"; echo "· dump local supprimé — il portait des données de santé"' EXIT

echo "· la base Scaleway porte-t-elle déjà des tables ?"
DEJA=$(${PG} psql "${CIBLE}" -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "${DEJA}" != "0" ] && [ "${ECRASER}" != "1" ]; then
  echo "⛔ ${DEJA} tables dans la base Scaleway. La recopie les REMPLACERAIT."
  echo "   Si c'est voulu (écritures gelées, répétition) : relancer avec --ecraser."
  exit 1
fi

echo "· dump de Neon (lecture seule)…"
${PG} pg_dump -Fc --no-subscriptions --no-publications "${SOURCE}" > "${TMP}/neon.dump"
echo "  $(du -h "${TMP}/neon.dump" | cut -f1)"

echo "· restauration dans Scaleway, par le propriétaire brokkr…"
NETTOYER=()
[ "${ECRASER}" = "1" ] && NETTOYER=(--clean --if-exists)
# Les erreurs sont MONTRÉES, pas filtrées : `pg_restore` rend la main même quand
# il en a eu (restauration du 27/08). Ce n'est pas leur absence qui conclut,
# c'est la preuve plus bas. Attendue : une extension de supervision que seul
# l'hébergeur installe (`pg_stat_statements`).
set +e
${PG} pg_restore --no-comments --no-owner ${NETTOYER[@]+"${NETTOYER[@]}"} -d "${CIBLE}" < "${TMP}/neon.dump" 2> "${TMP}/restauration.log"
set -e
ERREURS=$(grep -c '^pg_restore: error' "${TMP}/restauration.log" || true)
echo "  ${ERREURS} erreur(s)"
grep '^pg_restore: error' "${TMP}/restauration.log" | sed 's/^/    /' | head -20 || true

echo "· bornes de session sur brokkr_app…"
${PG} psql "${APPLI}" -v ON_ERROR_STOP=1 -q \
  -c "ALTER ROLE CURRENT_USER SET statement_timeout = '15s'" \
  -c "ALTER ROLE CURRENT_USER SET lock_timeout = '5s'" \
  -c "ALTER ROLE CURRENT_USER SET timezone = 'Europe/Paris'"

echo "· la preuve, table par table…"
COMPTER="SELECT string_agg(format('%s=%s', c.relname,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text),
           ' ' ORDER BY c.relname)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'"
${PG} psql "${SOURCE}" -tA -c "${COMPTER}" | tr ' ' '\n' > "${TMP}/neon.txt"
${PG} psql "${CIBLE}"  -tA -c "${COMPTER}" | tr ' ' '\n' > "${TMP}/scaleway.txt"
if ! diff "${TMP}/neon.txt" "${TMP}/scaleway.txt" > "${TMP}/ecarts.txt"; then
  echo "⛔ les deux bases ne portent PAS les mêmes lignes :"
  sed 's/^/    /' "${TMP}/ecarts.txt"
  exit 1
fi
echo "  $(wc -l < "${TMP}/neon.txt" | tr -d ' ') tables, $(cut -d= -f2 "${TMP}/neon.txt" | paste -sd+ - | bc) lignes, identiques"

# Ce que l'application peut faire, table par table : la même chose des deux côtés.
DROITS="SELECT c.relname || '=' || concat_ws(',',
           CASE WHEN has_table_privilege('brokkr_app', c.oid, 'SELECT') THEN 'S' END,
           CASE WHEN has_table_privilege('brokkr_app', c.oid, 'INSERT') THEN 'I' END,
           CASE WHEN has_table_privilege('brokkr_app', c.oid, 'UPDATE') THEN 'U' END,
           CASE WHEN has_table_privilege('brokkr_app', c.oid, 'DELETE') THEN 'D' END)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
           -- les objets d'une extension (supervision de l'hébergeur) ne sont pas les nôtres
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
         ORDER BY 1"
${PG} psql "${SOURCE}" -tA -c "${DROITS}" > "${TMP}/droits-neon.txt"
${PG} psql "${CIBLE}"  -tA -c "${DROITS}" > "${TMP}/droits-scaleway.txt"
if ! diff "${TMP}/droits-neon.txt" "${TMP}/droits-scaleway.txt" > "${TMP}/ecarts.txt"; then
  echo "⛔ brokkr_app n'a PAS les mêmes droits des deux côtés :"
  sed 's/^/    /' "${TMP}/ecarts.txt"
  exit 1
fi
echo "  droits de brokkr_app identiques sur $(wc -l < "${TMP}/droits-neon.txt" | tr -d ' ') tables et vues"

BORNES=$(${PG} psql "${APPLI}" -tA -c "SELECT current_setting('statement_timeout') || ' ' || current_setting('lock_timeout') || ' ' || current_setting('TimeZone')")
if [ "${BORNES}" != "15s 5s Europe/Paris" ]; then
  echo "⛔ brokkr_app ne reçoit pas ses bornes : « ${BORNES} »"
  exit 1
fi
echo "  bornes reçues par brokkr_app : ${BORNES}"
echo "[copie] OK — la base Scaleway porte la production d'il y a un instant"
