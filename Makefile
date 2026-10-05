.PHONY: help install gen contrat dev dev-local web api-python api livrer bac-a-sable bac-a-sable-remplir anciennes-origines

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# Un seul geste sur une machine neuve : les deux venvs/node_modules, et les
# fournisseurs Terraform (sans toucher à l'état distant).
install: ## Installe les dépendances des quatre dossiers (uv, go, npm, terraform init)
	$(MAKE) --no-print-directory -C api-python install
	$(MAKE) --no-print-directory -C api install
	cd web && npm ci
	cd infra && terraform init -input=false

# LE CONTRAT UNIQUE : `proto/` engendre le Go de sindri et le TypeScript
# d'eitri ; les requêtes SQL de sindri engendrent leur Go. Le résultat est
# COMMITTÉ, et `contrat` refuse qu'il diverge de sa source — c'est la même
# règle que `make -C api-python contrat` pour l'OpenAPI, au même endroit qu'on lit.
gen: ## Regénère le code depuis proto/ et les requêtes SQL (buf, sqlc)
	$(MAKE) --no-print-directory -C api gen

contrat: gen ## Le code engendré committé est-il celui du contrat ? (échoue s'il diverge)
	@[ "$$(git rev-parse --show-toplevel 2>/dev/null)" = "$$(pwd)" ] \
		|| { echo "✗ pas de dépôt git à la racine de hodos : rien ne peut dire si le code engendré est committé."; exit 1; }
	@if [ -n "$$(git status --porcelain -- proto api/gen api/internal/db web/src/gen)" ]; then \
		echo "✗ Le code engendré diverge du contrat — 'make gen', puis commit :"; \
		git status --short -- proto api/gen api/internal/db web/src/gen; \
		exit 1; \
	fi; echo "[contrat] OK — le code engendré est celui de proto/ et des requêtes"

dev: ## Démarre la stack locale (web + api-python + api) via mprocs — ⚠️ sur la PRODUCTION
	@command -v mprocs >/dev/null 2>&1 || { echo "mprocs manquant → brew install mprocs"; exit 1; }
	mprocs

# ⚠️ LA STACK QUI N'ÉCRIT PAS EN PRODUCTION. `make dev` fait parler brokkr à
# Neon : bon pour lire, piège pour tout le reste — un front qui tourne sur une
# base que sa version ne comprend pas encore y écrit quand même. Celle-ci rend
# ce risque nul : la copie se refait, la production ne se refait pas.
#
# ⚠️ ELLE NE REMPLIT PAS LA COPIE, ET C'EST DÉLIBÉRÉ : `bac-a-sable-remplir`
# télécharge de vraies données de santé sur le poste, et ne doit pas partir
# d'un `make dev-local` tapé par réflexe. Le compte affiché ci-dessous dit tout
# de suite si la copie est là, et la cible le rappelle quand elle est vide.
dev-local: bac-a-sable ## La même stack, mais sur le BAC À SABLE (aucune écriture n'atteint la prod)
	@command -v mprocs >/dev/null 2>&1 || { echo "mprocs manquant → brew install mprocs"; exit 1; }
	@n=$$(docker exec ff-training psql -U postgres -d ff -tA \
		-c "SELECT count(*) FROM athletes" 2>/dev/null || echo 0); \
	if [ "$${n}" = "0" ]; then \
		echo "⛔ le bac à sable est VIDE — 'make bac-a-sable-remplir' d'abord."; exit 1; \
	fi; \
	echo "· bac à sable : $${n} athlètes"
	@echo "· les écritures de cette stack restent locales"
	mprocs --config mprocs-local.yaml

# Renommé de `front` le 2026-08-17 : la cible pointait sur french-forge-trainer/app,
# c'est-à-dire la V2 ÉTEINTE depuis le 16/08. `make front` démarrait donc l'ancien
# produit. Seul eitri est vivant.
#
# Sans brokkr à côté, le front suit son `.env.local` et parle au brokkr de
# PRODUCTION — c'est voulu, on travaille souvent le front sans lancer le back.
# Sous mprocs, la variable d'environnement le ramène en local.
web: ## Front seul (Vite, :5173) — parle à l'api-python de PROD
	cd web && npm run dev

api-python: ## api-python seule (uvicorn, :8080)
	$(MAKE) -C api-python dev

api: ## api (Go, Connect, :8081) seule — sur la base du .env d'api-python
	$(MAKE) -C api dev

# --------------------------------------------------------------------------- #
# LIVRER LES DEUX, DANS LE BON ORDRE
#
# ⚠️ LE SERVEUR PASSE AVANT LE FRONT, TOUJOURS, et ce n'est pas une préférence :
# c'est la seule direction qui ne casse rien.
#
#   serveur d'abord : le nouveau serveur comprend l'ancien contrat, puisque
#                     l'ancien front n'envoie rien de neuf. Rien ne bouge tant
#                     que le front n'est pas là ;
#   front d'abord   : le nouveau front envoie une forme que l'ancien serveur ne
#                     connaît pas, et l'ancien serveur en fait ce qu'il peut.
#
# ⚠️ CE N'EST PAS THÉORIQUE, C'EST ARRIVÉ DEUX FOIS EN DEUX JOURS. Les deux
# déploiements étaient lancés ENSEMBLE, et l'hébergement du front finit toujours
# le premier — il publie des fichiers, l'autre construit une image et bascule une
# révision. Le 09/09, la carte Objectifs a affiché une liste vide pour tout le
# monde, parce que le front lisait `{goals, version}` d'un serveur qui rendait
# encore un tableau nu (FRE-134). Le 10/09, noter un RPE l'EFFAÇAIT : le front
# envoyait `{scalaire, tableau vide}`, paire que l'ancien serveur lisait comme
# « calcule la moyenne d'un vide ».
#
# Les deux cibles se vérifient déjà chacune — `brokkr deploy` interroge le
# processus qui tourne, `eitri hosting` interroge le paquet servi. Ce qui
# manquait n'était pas une vérification de plus, c'était l'ORDRE. `make` s'arrête
# à la première erreur : si le serveur ne se prouve pas, le front ne part pas.
#
# Les migrations restent MANUELLES et passent avant (`brokkr deploy` refuse tant
# qu'il en reste une en attente).
# ⚠️ ET LE HARNAIS RÉEL PASSE AVANT LES DEUX (FRE-129). Le grief du ticket était
# qu'il « ne tourne pas » : il est le SEUL filet qui traverse navigateur → eitri
# → brokkr → Postgres, et il n'était accroché à rien. Une régression de FRE-113
# a survécu trois jours parce que personne ne l'avait lancé.
#
# La règle maison nomme trois endroits qu'on lit — une cible `make`, le démarrage
# du harnais, le déploiement. La CI n'en fait pas partie, et c'est pour ça que
# ce garde-fou est ICI et pas dans un `ci.yml` : c'est le moment où l'on
# s'apprête à toucher la production.
#
# ⚠️ IL EST DANS `livrer` ET PAS DANS `brokkr deploy`, parce que ce qu'il éprouve
# est le CONTRAT ENTRE LES DEUX. `brokkr deploy` seul n'a pas de front à faire
# parler ; c'est ici qu'on livre la paire.
#
# ⚠️ CE QU'IL PROUVE, ET CE QU'IL NE PROUVE PAS. Il joue l'arbre de travail
# courant contre le bac à sable, pas l'image déjà construite contre la
# production. Il dit « ce code-là marche bout en bout sur un schéma de forme
# réelle » — c'est exactement le trou que le mock laisse, dont les writers sont
# des no-op.
#
# ⚠️ ET IL SE CONTOURNE, EXPLICITEMENT : `SANS_HARNAIS=1 make livrer`. Un
# garde-fou qui empêche un retour arrière en urgence est un danger, pas une
# sécurité — la panne du 08/09 s'est réparée en redéployant vite. Le contournement
# est bruyant pour qu'il reste un choix, pas une habitude. (Le repli direct reste
# `make -C api-python deploy SHA=abc1234`, qui ne passe pas par ici.)
#
# ⚠️ LE COMPTE gcloud SE PROUVE EN PREMIER, avant les quatre minutes du harnais :
# découvrir un jeton expiré à l'étape 2 fait rejouer tout le reste. La règle
# vit dans `cloudrun.mk` (`compte-gcloud`), une fois ; ici on l'appelle.
livrer: ## ⚠️ PROD : harnais réel, puis api-python, puis api, puis web — jamais l'inverse
	@$(MAKE) --no-print-directory -C api-python compte-gcloud
	@# Le numéro affiché se vérifie AVANT que rien ne parte : découvert à l'étape 4,
	@# les serveurs seraient déjà livrés sous un numéro qui ne bouge pas.
	@cd web && node scripts/numero-de-version.mjs verifier
ifeq ($(SANS_HARNAIS),1)
	@echo "⚠️  harnais réel SAUTÉ (SANS_HARNAIS=1) — on livre sans le filet front↔brokkr"
else
	@echo "· 1/4 — harnais réel (navigateur → web → api-python → Postgres)"
	@./scripts/e2e-reel.sh
	@echo
endif
	@echo "· 2/4 — api-python (image du SHA, puis contrat, schéma, migrations, déploiement, SHA et bornes servis)"
	@$(MAKE) --no-print-directory -C api-python build
	@$(MAKE) --no-print-directory -C api-python deploy
	@echo
	@echo "· 3/4 — api, le Go (image du SHA, déploiement, SHA et bornes servis)"
	@$(MAKE) --no-print-directory -C api build
	@$(MAKE) --no-print-directory -C api deploy
	@echo
	@echo "· 4/4 — web (les deux serveurs se sont prouvés, le front peut partir)"
	@$(MAKE) --no-print-directory -C web hosting


# Les anciennes adresses ont quitté `allowed_origins` le 13/09 (FRE-146), après
# quatre jours où cette cible ne rendait plus personne. Elle reste : brokkr ne
# leur répond plus, mais Cloud Run journalise encore l'appel refusé — c'est le
# seul endroit où l'on verrait quelqu'un resté coincé sur une ancienne adresse.
anciennes-origines: ## Qui passe encore par *.web.app / *.firebaseapp.com (JOURS=7, lecture des logs Cloud Run)
	@api-python/.venv/bin/python scripts/anciennes_origines.py $(or $(JOURS),7)


# --------------------------------------------------------------------------- #
# LE BAC À SABLE (FRE-61)
#
# ⚠️ IL ÉTAIT MONTÉ À LA MAIN, et sa procédure de remplissage vivait en
# commentaire. Le harnais e2e réel s'arrête net si `ff-training` ne répond pas :
# sur une machine neuve, rien ne démarrait.
# --------------------------------------------------------------------------- #

bac-a-sable: ## Démarre le bac à sable Postgres (:55433) et attend qu'il réponde
	@docker volume inspect ff-training-data >/dev/null 2>&1 || { \
		echo "· volume absent — création (machine neuve)"; \
		docker volume create ff-training-data >/dev/null; }
	@docker compose up -d
	@for i in $$(seq 1 30); do \
		docker exec ff-training pg_isready -U postgres -d ff >/dev/null 2>&1 && { echo "· prêt"; exit 0; }; \
		sleep 1; done; \
		echo "⛔ le bac à sable ne répond pas"; exit 1

# ⚠️ CETTE CIBLE LIT LA PRODUCTION ET LA COPIE SUR TON POSTE. Ce sont de vraies
# données : noms, mesures, antécédents, bilans kiné. Décision assumée (28/08) —
# le réalisme sert à écrire des tests depuis ce que font vraiment les coachs.
#
# ⚠️ LE RÔLE `brokkr` SE CRÉE AVANT LA RESTAURATION. Les objets du dump lui
# appartiennent : sans lui, `pg_restore` produit 56 erreurs « role does not
# exist » PUIS REND LA MAIN NORMALEMENT — la donnée est là, mais plus rien ne lui
# appartient. Éprouvé le 27/08, cf. infra/RESTAURATION.md.
#
# La prod n'est ouverte qu'en LECTURE : `pg_dump`, jamais autre chose.
bac-a-sable-remplir: bac-a-sable ## ⚠️ Recopie la PROD dans le bac à sable (données réelles)
	@test -n "$(DATABASE_URL)" || { echo "⛔ DATABASE_URL manquante (source api-python/.env)"; exit 1; }
	@echo "· dump de la production (lecture seule)…"
	@docker exec ff-training pg_dump -Fc "$(DATABASE_URL)" > /tmp/ff-prod.dump 2>/dev/null \
		|| { echo "⛔ le dump a échoué"; rm -f /tmp/ff-prod.dump; exit 1; }
	@docker exec ff-training psql -U postgres -q -c "DROP DATABASE IF EXISTS ff;" \
		-c "CREATE ROLE brokkr LOGIN;" -c "CREATE DATABASE ff OWNER brokkr;" 2>/dev/null || true
	@docker cp /tmp/ff-prod.dump ff-training:/tmp/ff.dump
	@docker exec ff-training pg_restore -U postgres -d ff --clean --if-exists /tmp/ff.dump 2>&1 \
		| grep -v "does not exist, skipping" | tail -3 || true
	@docker exec ff-training rm -f /tmp/ff.dump
	@rm -f /tmp/ff-prod.dump
	@echo "· dump local supprimé — il portait des données de santé"
	@docker exec ff-training psql -U postgres -d ff -tA \
		-c "SELECT '· ' || count(*) || ' exercices' FROM training_exercises"
