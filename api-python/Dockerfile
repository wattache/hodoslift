FROM python:3.12-slim

# uv : on copie le binaire depuis l'image officielle Astral (pinnée).
COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /srv

# Deps d'abord (couche cache séparée du code applicatif).
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev

COPY app ./app
# `scripts/` part dans l'image : le Cloud Run Job de rafraîchissement analytics
# (nidavellir/analytics.tf) réutilise CETTE image en écrasant la commande, plutôt
# que d'en maintenir une seconde. Les ETL de migration y sont aussi, inertes.
COPY scripts ./scripts

# Cloud Run injecte $PORT (8080 par défaut).
# ⚠️ LA VERSION DU CODE, INJECTÉE AU BUILD. L'image est taguée `:latest` et
# `pyproject` dit `0.1.0` depuis toujours : sans ceci, rien ne distingue deux
# déploiements, et Sentry ne peut pas dire « cette erreur est apparue mardi ».
#
# Le SHA plutôt qu'un numéro de version : il mène directement au commit, ce
# qu'un `0.2.0` ne fait pas. Vide si le build ne le fournit pas — le code
# retombe alors sur la révision Cloud Run, voir `app/socle/config.py`.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

# ⚠️ PAS DE ROOT DANS LE CONTENEUR (FRE-88). Sans cette ligne, le processus tourne
# en root : un défaut d'exécution de code dans une dépendance donne alors tous les
# droits sur le système de fichiers de l'image, `/srv` et l'environnement virtuel
# compris. Cloud Run isole déjà bien, donc ce n'est pas une faille — c'est une
# couche gratuite qu'on n'avait pas.
#
# ⚠️ APRÈS les COPY et le `uv sync`, jamais avant : ces étapes écrivent dans /srv
# et échoueraient sans les droits. Et le port 8080 est au-dessus de 1024, donc un
# utilisateur ordinaire peut l'ouvrir — c'est ce qui rend le changement gratuit.
# ⚠️ ET `HOME` DOIT SUIVRE, sinon le conteneur construit mais NE DÉMARRE PAS :
# `uv run` tente d'ouvrir son cache dans `$HOME/.cache/uv`, et un compte système
# sans répertoire personnel n'a nulle part où l'écrire — « failed to create
# directory /home/brokkr/.cache/uv: Permission denied ». Le pointer sur /srv, qui
# vient d'être donné à cet utilisateur, suffit. Vu en le lançant, pas en le
# construisant : le `docker build` passait très bien sans cette ligne.
RUN useradd --system --no-create-home --uid 10001 brokkr \
 && chown -R brokkr:brokkr /srv
ENV HOME=/srv
USER brokkr

ENV PORT=8080
CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
