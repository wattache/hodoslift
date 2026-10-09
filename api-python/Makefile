# Le service Cloud Run garde son nom historique, `brokkr` : le renommer créerait
# un service neuf, avec une autre URL, que le front et le site vitrine appellent.
SERVICE        = brokkr
API_PYTHON_DIR = .
# Toujours chaud : un Python qui démarre à froid fait attendre plusieurs secondes.
MIN_INSTANCES  = 1
# Le registre, le SHA, `build`, `verifier` et le service des images vivent dans
# `../cloudrun.mk`, partagé avec l'api Go.
include ../cloudrun.mk

.PHONY: install lock dev test lint openapi carte deploy version schema-verifier invariants contrat migrations

install: ## Installe les deps (uv : crée .venv + respecte uv.lock)
	uv sync

lock: ## Régénère le lockfile après modif des deps dans pyproject.toml
	uv lock

test: ## Lance les tests
	uv run pytest

lint: ## Noms indéfinis, imports et variables morts (ruff, lint seul)
	uv run ruff check app scripts tests

openapi: ## Écrit docs/openapi.json — LE CONTRAT, à régénérer après tout changement de réponse
	uv run python scripts/exporter_openapi.py

# Lue depuis un Postgres jetable chargé avec le fichier de schéma (Docker), pas
# depuis le fichier lui-même : la carte ne peut pas dire autre chose que la base.
carte: ## Écrit docs/carte-de-brokkr.html — le schéma par domaine ; à régénérer avec chaque migration
	python3 docs/carte.py


# brokkr vérifie les jetons sans identité Google (`app/socle/firebase_admin_app.py`) :
# aucune clé de compte de service n'est nécessaire, ni ici ni sur Scaleway.
dev: ## Lance en local (http://localhost:8080), sur la base du `.env`
	uv run uvicorn app.main:app --reload --port 8080

version: ## Affiche le SHA qui servirait de version au prochain build
	@echo $(SHA)

# STRICT=1 : refuse de conclure sans Docker (code 2). Sans Docker, seuls les NOMS
# sont comparés — et « vérifié à moitié » ne vaut pas « vérifié » avant un
# déploiement (FRE-154).
schema-verifier: ## Vérifie que docs/postgres-schema.sql décrit encore la VRAIE base (STRICT=1 : exige Docker)
	uv run python scripts/verifier_schema.py $(if $(STRICT),--strict,)

# `schema-verifier` compare la FORME (tables, colonnes) ; celui-ci interroge le
# CONTENU — les invariants que les commentaires du code affirment (FRE-143).
# Lecture seule : on peut le lancer contre la prod sans précaution.
invariants: ## Vérifie sur la vraie base les invariants affirmés par les commentaires
	uv run python scripts/verifier_invariants.py --verbeux

# ⚠️ LE CONTRAT SE VÉRIFIE ICI, PAS EN CI (FRE-154). La CI le faisait déjà — et
# n'est jamais lue sur ce projet : il a dérivé sur huit chemins sans que personne
# ne le voie, dont un code d'erreur que le front ne pouvait pas traduire parce
# que ses types, engendrés depuis ce fichier, ne le connaissaient pas.
contrat: ## Le contrat OpenAPI committé est-il celui du code ? (le front en engendre ses types)
	uv run python scripts/exporter_openapi.py --check

# Lecture seule : dit ce qui reste à appliquer sur la base visée par `.env`, et
# ÉCHOUE s'il en reste. C'est la porte que `make deploy` franchit avant de partir.
migrations: ## Ce qui reste à appliquer sur la base (lecture seule ; échoue s'il en reste)
	uv run python -m scripts.migrer

# ⚠️ QUATRE PORTES AVANT DE PARTIR (FRE-154) : contrat, schéma, migrations,
# invariants, en lecture seule, sur la base de `.env` — celle qu'on s'apprête à
# servir. Puis l'image du SHA, et la preuve par le processus qui tourne
# (`../cloudrun.mk`). `make livrer` joue les invariants plus tôt encore, avant
# le harnais ; ici ils gardent un `make deploy` lancé seul.
deploy: ## ⚠️ PROD : déploie l'image du commit courant sur Cloud Run (ou SHA=abc1234 pour revenir à une version connue)
	@$(MAKE) --no-print-directory contrat
	@$(MAKE) --no-print-directory schema-verifier STRICT=1
	@$(MAKE) --no-print-directory migrations
	@$(MAKE) --no-print-directory invariants
	@$(MAKE) --no-print-directory deploy-image SHA=$(SHA)
