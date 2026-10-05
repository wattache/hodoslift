# Le déploiement d'un service sur Scaleway, une seule définition pour les trois :
# deux copies divergeraient au premier correctif.
#
#   api-python/Makefile, api/Makefile  l'incluent, après avoir posé `SERVICE` ;
#   web/Makefile                       l'appelle (`-f ../scaleway.mk SERVICE=web`),
#                                      ses propres `build` et `verifier` étant pris.
#
# ⚠️ L'IMAGE PORTE LE SHA, ET LE DÉPLOIEMENT DEMANDE CE SHA-LÀ. Un `deploy` sans
# `build` échoue au lieu de re-servir l'image d'avant : l'image n'existe pas
# dans le registre. `SHA=abc1234` désigne une version connue — le retour arrière.
#
# ⚠️ LA VERSION EST LE DERNIER COMMIT QUI TOUCHE LE DOSSIER DU SERVICE, pas la
# tête du dépôt : un commit d'un autre dossier ne change rien à ce qu'il sert.
#
# Les identifiants viennent du profil `scw` (`~/.config/scw/config.yaml`), comme
# pour Terraform : une seule chose à révoquer.

# bash : les recettes lisent l'id et l'URL du conteneur d'un seul `read <<<`.
SHELL := /bin/bash

# Le Makefile qui porte SERVICE : les appels récursifs le relisent, qu'il ait
# inclus ce fichier ou l'ait appelé par `-f`.
SCW_MK        := $(firstword $(MAKEFILE_LIST))
# Les bornes de session ne concernent que les services qui lisent la base.
VERIFIER_BORNES ?= 1

SCW_REGION    ?= fr-par
SCW_NAMESPACE ?= hodos
REGISTRY       = rg.$(SCW_REGION).scw.cloud/$(SCW_NAMESPACE)
SHA           ?= $(shell git log -1 --format=%h -- .)
IMAGE_SHA      = $(REGISTRY)/$(SERVICE):$(SHA)
# `:latest` est le tag de commodité (Terraform le déclare à la création) ; plus
# rien ne le DÉPLOIE.
IMAGE          = $(REGISTRY)/$(SERVICE):latest

# Le conteneur, retrouvé par son nom dans l'espace `hodos` : `id url`.
define CONTENEUR
scw container namespace list name=$(SCW_NAMESPACE) region=$(SCW_REGION) -o json \
 | python3 -c "import json,sys; n=json.load(sys.stdin); sys.exit('✗ espace de conteneurs « $(SCW_NAMESPACE) » introuvable') if len(n)!=1 else print(n[0]['id'])" \
 | xargs -I{} scw container container list namespace-id={} name=$(SERVICE) region=$(SCW_REGION) -o json \
 | python3 -c "import json,sys; c=json.load(sys.stdin); sys.exit('✗ conteneur « $(SERVICE) » introuvable') if len(c)!=1 else print(c[0]['id'], c[0].get('public_endpoint') or 'https://'+c[0]['domain_name'])"
endef

.PHONY: compte-scaleway build deploy-image verifier

# Sans dépôt git, pas de version : une image taguée « rien » ne part pas.
define EXIGER_UN_SHA
	@[ -n "$(SHA)" ] || { echo "✗ aucune version : pas de commit qui touche ce dossier (ou pas de dépôt git)."; exit 1; }
endef

# ⚠️ LE COMPTE SE PROUVE AVANT LE GESTE, il ne se suppose pas : le profil `scw`
# répond-il, et voit-il le registre de Hodos ? Sans registre, c'est l'étape 1 du
# premier apply qui manque (`infra/scaleway_applicatif.tf`).
compte-scaleway: ## Le profil scw répond-il, et voit-il le registre de Hodos ?
	@scw registry namespace list name=$(SCW_NAMESPACE) region=$(SCW_REGION) -o json 2>/dev/null \
	 | python3 -c "import json,sys; n=json.load(sys.stdin); sys.exit(0 if len(n)==1 else 1)" \
	 || { echo "✗ scw ne voit pas le registre « $(SCW_NAMESPACE) » : 'scw init', ou l'étape 1 du premier apply."; exit 1; }
	@echo "→ scaleway : registre $(REGISTRY)"

# ⚠️ UN ARBRE MODIFIÉ NE SE CONSTRUIT PAS POUR LA PROD : le SHA cuit dans l'image
# désignerait un contenu qui n'existe dans aucun commit. Seul le dossier du
# service compte.
build: ## Build + push l'image taguée par le SHA (déploiement MANUEL)
	$(EXIGER_UN_SHA)
	@if [ -n "$$(git status --porcelain -- .)" ]; then \
		echo "✗ Arbre de travail modifié — commit (ou remise) avant de construire."; \
		echo "  L'image serait taguée $(SHA), un commit qui ne contient pas ce code."; \
		git status --short -- .; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory -f $(SCW_MK) compte-scaleway
	scw registry login region=$(SCW_REGION)
	docker build --platform linux/amd64 --build-arg GIT_SHA=$(SHA) -t $(IMAGE_SHA) -t $(IMAGE) .
	docker push $(IMAGE_SHA)
	docker push $(IMAGE)

# Sert l'image du SHA, attend que le conteneur soit prêt, puis se prouve.
deploy-image:
	$(EXIGER_UN_SHA)
	@$(MAKE) --no-print-directory -f $(SCW_MK) compte-scaleway
	@set -e; read ID URL <<< "$$($(CONTENEUR))"; \
	echo "→ $(SERVICE) ($$ID) ← $(IMAGE_SHA)"; \
	scw container container update $$ID image=$(IMAGE_SHA) region=$(SCW_REGION) -w >/dev/null
	@$(MAKE) --no-print-directory -f $(SCW_MK) verifier SHA=$(SHA)

# LE DÉPLOIEMENT SE PROUVE, il ne se raconte pas : on interroge le processus qui
# tourne — sa version (`/health`), puis, pour les services qui lisent la base,
# les bornes de session qu'il reçoit (`/health/db`, lues par le script
# d'api-python).
verifier: ## Vérifie que Scaleway exécute bien la version attendue (SHA=... pour une autre)
	@$(MAKE) --no-print-directory -f $(SCW_MK) compte-scaleway
	@set -e; read ID URL <<< "$$($(CONTENEUR))"; \
	SERVIE=$$(curl -sf "$$URL/health" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version') or 'aucune')"); \
	if [ "$$SERVIE" = "$(SHA)" ]; then \
		echo "[verif] OK — $(SERVICE) exécute bien $(SHA) ($$URL)"; \
		if [ "$(VERIFIER_BORNES)" = "1" ]; then (cd $(API_PYTHON_DIR) && uv run python scripts/verifier_bornes_servies.py "$$URL"); fi; \
	else \
		echo ""; \
		echo "[verif] ÉCHEC — $(SERVICE) n'exécute PAS la version attendue."; \
		echo "        attendu : $(SHA)"; \
		echo "        exécuté : $$SERVIE"; \
		echo ""; \
		echo "  Ne pas annoncer cette version comme livrée tant que ceci ne passe pas."; \
		exit 1; \
	fi
