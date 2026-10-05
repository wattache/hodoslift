// Package socle porte ce que tout domaine de sindri partage : la configuration,
// la base, l'authentification, l'autorisation, les erreurs, le journal.
package socle

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
)

// Config est lue dans l'environnement, avec les MÊMES noms que brokkr
// (`app/socle/config.py`) : les deux services tournent côte à côte sur la même
// base, avec la même identité, et Terraform pose les mêmes variables.
type Config struct {
	Port              string
	ProjectID         string
	DatabaseURL       string
	DBHost            string
	DBPort            string
	DBUser            string
	DBPassword        string
	DBName            string
	SentryDSN         string
	SentryEnvironment string
	GitSHA            string
	KRevision         string
	AllowedOrigins    []string
}

func lire(nom, defaut string) string {
	if v, ok := os.LookupEnv(nom); ok {
		return v
	}
	return defaut
}

// Charger lit l'environnement. Aucun fichier `.env` : le Makefile le source.
func Charger() Config {
	return Config{
		Port:              lire("PORT", "8081"),
		ProjectID:         lire("PROJECT_ID", "french-forge-600"),
		DatabaseURL:       lire("DATABASE_URL", ""),
		DBHost:            lire("DB_HOST", ""),
		DBPort:            lire("DB_PORT", "5432"),
		DBUser:            lire("DB_USER", ""),
		DBPassword:        lire("DB_PASSWORD", ""),
		DBName:            lire("DB_NAME", ""),
		SentryDSN:         lire("SENTRY_DSN", ""),
		SentryEnvironment: lire("SENTRY_ENVIRONMENT", "local"),
		GitSHA:            lire("GIT_SHA", ""),
		KRevision:         lire("K_REVISION", ""),
		AllowedOrigins:    origines(),
	}
}

// origines : `ALLOWED_ORIGINS` (liste JSON, comme brokkr), sinon les deux
// origines de production. Une liste illisible retombe sur la production : on
// n'ouvre jamais plus large par erreur.
func origines() []string {
	prod := []string{"https://trainer.french-forge.com", "https://french-forge.com"}
	brut := lire("ALLOWED_ORIGINS", "")
	if brut == "" {
		return prod
	}
	var liste []string
	if err := json.Unmarshal([]byte(brut), &liste); err != nil {
		slog.Error("ALLOWED_ORIGINS illisible — origines de production seules", "erreur", err.Error())
		return prod
	}
	return liste
}

// VersionDeployee est le SHA cuit dans l'image, sinon la révision Cloud Run,
// sinon "" (local). C'est ce que `/health` rend et que `make verifier` compare.
func (c Config) VersionDeployee() string {
	if c.GitSHA != "" {
		return c.GitSHA
	}
	return c.KRevision
}

// Local dit si le poste est un poste de développement — FERMÉ par défaut, comme
// brokkr : un `SENTRY_ENVIRONMENT` perdu au déploiement ferme localhost au
// lieu de l'ouvrir en silence.
func (c Config) Local() bool {
	return c.SentryEnvironment == "" || c.SentryEnvironment == "local"
}

// URLPostgres : `DATABASE_URL` en local, les parties `DB_*` en production.
// Le préfixe `postgresql+psycopg://` du `.env` de brokkr est accepté, pour ne
// pas dupliquer le secret sous une autre forme.
func (c Config) URLPostgres() string {
	if c.DatabaseURL != "" {
		return strings.Replace(c.DatabaseURL, "postgresql+psycopg://", "postgresql://", 1)
	}
	u := url.URL{
		Scheme:   "postgresql",
		User:     url.UserPassword(c.DBUser, c.DBPassword),
		Host:     net.JoinHostPort(c.DBHost, c.DBPort),
		Path:     "/" + c.DBName,
		RawQuery: "sslmode=require",
	}
	return u.String()
}
