# Le front construit (`dist/`, par `npm run build` sur le poste, comme pour
# Firebase Hosting) servi par Caddy. Rien n'est compilé ici : l'image ne porte
# que les fichiers publiés et la configuration du routage.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY dist /srv

# ⚠️ LA VERSION DU FRONT, INJECTÉE AU BUILD : `/health` la rend, `make verifier`
# la compare au SHA attendu.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
ENV PORT=8080
