# api — l'API en Go, servie en Connect, sur Cloud Run. Même registre et même
# grille de déploiement qu'api-python (`../cloudrun.mk`) : `build` pousse
# l'image du SHA, `deploy` la sert, `verifier` interroge le processus.
SERVICE    = api
API_PYTHON_DIR = ../api-python
PORT      ?= 8081
# Il dort sans requête : un binaire Go démarre en moins d'une seconde.
MIN_INSTANCES = 0
# Le registre, le SHA, `build`, `verifier` et le service des images vivent dans
# `../cloudrun.mk`, partagé avec api-python.
include ../cloudrun.mk

.PHONY: install gen dev test lint version deploy

install: ## Télécharge les modules Go
	go mod download

# Le contrat (proto/ → Go et TypeScript) et les requêtes (SQL → Go). Le code
# engendré est COMMITTÉ ; `make contrat` à la racine refuse une dérive.
gen: ## Regénère le code depuis proto/ (buf) et les requêtes SQL (sqlc)
	sqlc generate
	cd ../proto && buf generate

# Le `.env` de brokkr porte déjà DATABASE_URL : on le lit, on ne le recopie pas.
dev: ## Lance en local (http://localhost:8081) sur la base du `.env` d'api-python
	@set -a; . ../api-python/.env; set +a; \
	PORT=$(PORT) go run ./cmd/sindri

test: ## Les tests, sur un Postgres 16 jetable (Docker)
	go test ./... -count=1

lint: ## go vet
	go vet ./...

version: ## Affiche le SHA qui servirait de version au prochain build
	@echo $(SHA)

deploy: ## ⚠️ PROD : déploie l'image du commit courant sur Cloud Run (ou SHA=abc1234), puis se prouve
	@$(MAKE) --no-print-directory deploy-image SHA=$(SHA)
