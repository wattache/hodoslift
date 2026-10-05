# Un binaire statique dans une image sans shell ni root : rien à exploiter.
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /api /api
# ⚠️ LA VERSION DU CODE, INJECTÉE AU BUILD : c'est ce que `/health` rend et que
# `make verifier` compare. Vide si le build ne la fournit pas — le code retombe
# alors sur la révision Cloud Run (`K_REVISION`).
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
# Cloud Run injecte $PORT (8080 par défaut).
ENV PORT=8080
USER nonroot
ENTRYPOINT ["/api"]
