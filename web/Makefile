# Eitri — dev + déploiement Firebase Hosting. Le déploiement reste MANUEL.
#
# ⚠️ DEUX SITES, deux repos, et le MÊME nom de target `app` des deux côtés :
#   ici          → site french-forge-600  = trainer.french-forge.com + .web.app  → EITRI
#   repo v2      → site french-forge-trainer-rewrite = .web.app                  → la V2
# `make hosting` d'ici ne touche donc PAS le site où vont les athlètes : il n'y a
# aucune bascule à craindre, ni à espérer. La v2 ne meurt que par le `make sunset`
# du repo french-forge-trainer.
# (Cet en-tête a affirmé l'inverse jusqu'au 2026-08-12 — la cible avait été
# réaffectée par 401ae0b sans que le commentaire suive. Vérifié en comparant les
# bundles servis, pas la configuration.)
# Pour tester en ligne SANS toucher la prod : `make preview` (canal temporaire).

.PHONY: dev build lint test-e2e preview canary hosting landing rules version verifier

# ⚠️ UN ARBRE MODIFIÉ NE SE PUBLIE PAS. La version d'un build est le SHA du
# commit (cf. scripts/version.mjs) ; construite depuis un arbre sale, elle
# désigne un contenu qui n'existe nulle part — et c'est ce mensonge-là qu'on ne
# découvre que trois jours plus tard, en cherchant pourquoi un correctif
# « déployé » est absent. Le build local reste libre (on travaille) ; seule la
# PUBLICATION refuse.
# Seul CE dossier compte : un fichier modifié dans api-python/ ne bloque pas le front.
define REFUSER_ARBRE_SALE
	@if [ -n "$$(git status --porcelain -- .)" ]; then \
		echo "✗ Arbre de travail modifié — commit (ou remise) avant de publier."; \
		echo "  La version publiée doit désigner un commit qui existe."; \
		git status --short -- .; \
		exit 1; \
	fi
endef

version: ## Affiche la version qu'un build produirait (le SHA court du commit)
	@node scripts/version.mjs

verifier: ## Vérifie que la PROD sert bien la version du commit courant
	@node scripts/verifier-deploiement.mjs

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint

test-e2e:
	npm run test:e2e

preview: ## Déploie sur un CANAL DE PREVIEW (URL temporaire 7 j, prod intacte)
	@FF_PUBLICATION=preview $(MAKE) --no-print-directory build
	npx firebase hosting:channel:deploy eitri --only app --expires 7d

# Le numéro affiché (`package.json`) se promeut à chaque livraison : un numéro
# déjà publié ne repart pas avec un autre contenu (scripts/numero-de-version.mjs).
# Le tag `v<numéro>` se pose APRÈS la vérification de la prod, jamais avant.
hosting: ## ⚠️ PROD : déploie sur https://trainer.french-forge.com (site french-forge-600)
	$(REFUSER_ARBRE_SALE)
	@node scripts/numero-de-version.mjs verifier
	@FF_PUBLICATION=prod $(MAKE) --no-print-directory build
	npx firebase deploy --only hosting:app
	@node scripts/verifier-deploiement.mjs
	@node scripts/numero-de-version.mjs poser

# Site VITRINE (french-forge.com) — un `landing/index.html` statique, sans build :
# ni Vite ni npm ne le touchent, `public: "landing"` le publie tel quel. TROISIÈME
# site du projet, à ne pas confondre avec les deux ci-dessus.
#
# Rapatrié du repo v2 le 2026-08-12, pour la même raison que les rules : ce repo
# s'éteint le 17 et la vitrine, elle, reste en ligne. C'est désormais l'unique
# source — la copie et la cible ont été retirées de là-bas.
landing: ## Déploie le site vitrine sur https://french-forge.com
	node landing/build-coachs.mjs
	npx firebase deploy --only hosting:landing

# Rules Firestore + Storage — rapatriées du repo v2 (firebase/), pour qu'Eitri
# soit autonome le jour où le v2 disparaît. Les DEUX repos les déploient sur le
# même projet : la dernière commande lancée gagne. Tant que le v2 vit, garder
# les deux copies alignées (ou ne déployer QUE depuis ici).
rules: ## Déploie les rules Firestore + Storage
	npx firebase deploy --only firestore:rules,storage:app
