# Le déploiement d'une API sur Cloud Run — inclus par api-python/Makefile et
# api/Makefile, qui posent `SERVICE` (le service Cloud Run, qui nomme aussi
# l'image) avant l'inclusion. Une seule définition : deux copies divergeraient
# au premier correctif.
#
# ⚠️ L'IMAGE PORTE LE SHA, ET LE DÉPLOIEMENT DEMANDE CE SHA-LÀ. Un `deploy` sans
# `build` échoue au lieu de re-servir l'image d'avant : l'image n'existe pas
# dans le registre. `SHA=abc1234` désigne une version connue — le retour arrière.
#
# ⚠️ LA VERSION EST LE DERNIER COMMIT QUI TOUCHE LE DOSSIER DU SERVICE, pas la
# tête du dépôt : un commit d'un autre dossier ne change rien à ce qu'il sert.
#
# La pile Scaleway, écrite pour le déménagement, a son équivalent :
# `scaleway.mk`.

PROJECT_ID = french-forge-600
# europe-west4 : la région du dépôt Artifact Registry et des services Cloud Run.
REGION     = europe-west4
REGISTRY   = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/french-forge-trainer
SHA       ?= $(shell git log -1 --format=%h -- .)
IMAGE_SHA  = $(REGISTRY)/$(SERVICE):$(SHA)
# `:latest` est le tag de commodité ; plus rien ne le DÉPLOIE.
IMAGE      = $(REGISTRY)/$(SERVICE):latest
# Les deux API ont l'identité de brokkr : même base, mêmes secrets.
SERVICE_ACCOUNT = brokkr@$(PROJECT_ID).iam.gserviceaccount.com
MIN_INSTANCES  ?= 0
MAX_INSTANCES  ?= 4
# Les bornes de session ne concernent que les services qui lisent la base.
VERIFIER_BORNES ?= 1

# ⚠️ LE COMPTE gcloud EST ÉPINGLÉ ICI, PAS DANS LA CONFIG DE LA MACHINE (13/09).
# `CLOUDSDK_CORE_ACCOUNT` est lu par chaque appel gcloud — et par l'assistant
# d'identifiants de docker — le temps du `make` seulement, sans rien écrire dans
# la config globale de gcloud.
GCLOUD_COMPTE ?= attachew974@gmail.com
export CLOUDSDK_CORE_ACCOUNT = $(GCLOUD_COMPTE)

.PHONY: compte-gcloud build deploy-image verifier

# Sans dépôt git, pas de version : une image taguée « rien » ne part pas.
define EXIGER_UN_SHA
	@[ -n "$(SHA)" ] || { echo "✗ aucune version : pas de commit qui touche ce dossier (ou pas de dépôt git)."; exit 1; }
endef

# ⚠️ LE COMPTE SE PROUVE AVANT LE GESTE, il ne se suppose pas : gcloud
# parlera-t-il bien au nom de `GCLOUD_COMPTE`, et ce compte a-t-il un jeton
# valide ? `print-access-token` est la seule vraie réponse à la seconde question.
compte-gcloud: ## Le compte gcloud est-il le bon, et connecté ? (GCLOUD_COMPTE=…)
	@EFFECTIF=$$(gcloud config get-value account 2>/dev/null); \
	if [ "$$EFFECTIF" != "$(GCLOUD_COMPTE)" ]; then \
		echo "✗ gcloud parlerait au nom de « $$EFFECTIF », pas de $(GCLOUD_COMPTE)."; \
		exit 1; \
	fi; \
	if ! gcloud auth print-access-token >/dev/null 2>&1; then \
		echo "✗ $(GCLOUD_COMPTE) n'a pas de jeton gcloud valide. À faire une fois :"; \
		echo "    gcloud auth login $(GCLOUD_COMPTE)"; \
		exit 1; \
	fi; \
	echo "→ gcloud : $(GCLOUD_COMPTE)"

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
	@$(MAKE) --no-print-directory compte-gcloud
	gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet
	docker build --platform linux/amd64 --build-arg GIT_SHA=$(SHA) -t $(IMAGE_SHA) -t $(IMAGE) .
	docker push $(IMAGE_SHA)
	docker push $(IMAGE)

# `--update-env-vars` (merge) et PAS `--set-env-vars` (replace) : Terraform pose
# les variables de la base sur le service ; un `--set-env-vars` les écraserait.
deploy-image:
	$(EXIGER_UN_SHA)
	@$(MAKE) --no-print-directory compte-gcloud
	gcloud run deploy $(SERVICE) --project=$(PROJECT_ID) --region=$(REGION) \
		--image=$(IMAGE_SHA) --allow-unauthenticated \
		--service-account=$(SERVICE_ACCOUNT) \
		--min-instances=$(MIN_INSTANCES) --max-instances=$(MAX_INSTANCES) \
		--update-env-vars=PROJECT_ID=$(PROJECT_ID)
	@$(MAKE) --no-print-directory verifier SHA=$(SHA)

# LE DÉPLOIEMENT SE PROUVE, il ne se raconte pas : on interroge le processus qui
# tourne — sa version (`/health`), puis les bornes de session qu'il reçoit
# (`/health/db`, lues par le script d'api-python).
verifier: ## Vérifie que la PROD exécute bien la version attendue (SHA=... pour une autre)
	@$(MAKE) --no-print-directory compte-gcloud
	@URL=$$(gcloud run services describe $(SERVICE) --project=$(PROJECT_ID) \
		--region=$(REGION) --format='value(status.url)'); \
	SERVIE=$$(curl -sf "$$URL/health" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version') or 'aucune')"); \
	if [ "$$SERVIE" = "$(SHA)" ]; then \
		echo "[verif] OK — $(SERVICE) exécute bien $(SHA) ($$URL)"; \
		if [ "$(VERIFIER_BORNES)" = "1" ]; then (cd $(API_PYTHON_DIR) && uv run python scripts/verifier_bornes_servies.py "$$URL") || exit 1; fi; \
	else \
		echo ""; \
		echo "[verif] ÉCHEC — $(SERVICE) n'exécute PAS la version attendue."; \
		echo "        attendu : $(SHA)"; \
		echo "        exécuté : $$SERVIE"; \
		echo ""; \
		echo "  Le déploiement a peut-être échoué, ou servi une autre image."; \
		echo "  Ne pas annoncer cette version comme livrée tant que ceci ne passe pas."; \
		exit 1; \
	fi
