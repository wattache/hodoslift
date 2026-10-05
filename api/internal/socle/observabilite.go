package socle

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/getsentry/sentry-go"
)

// InstallerSentry branche Sentry si un DSN est posé. `release` = la version
// déployée, sinon Sentry ne situe pas une erreur dans le temps. Jamais de PII,
// jamais de corps de requête : ils portent le poids, les blessures, les notes.
func InstallerSentry(cfg Config) func() {
	if cfg.SentryDSN == "" {
		slog.Info("Sentry non configuré (SENTRY_DSN vide) — aucun envoi")
		return func() {}
	}
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:              cfg.SentryDSN,
		Environment:      cfg.SentryEnvironment,
		Release:          cfg.VersionDeployee(),
		SendDefaultPII:   false,
		TracesSampleRate: 0.1,
	}); err != nil {
		slog.Error("Sentry : initialisation refusée", "erreur", err.Error())
		return func() {}
	}
	return func() { sentry.Flush(2 * time.Second) }
}

// Filet : ce qui ÉCHAPPE au code sort quand même sous la forme unique. Sans
// lui, une panique coupe la connexion et le navigateur y voit une panne
// réseau, sans code à traduire.
func Filet() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (res connect.AnyResponse, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = Interne(fmt.Errorf("panique : %v", r))
				}
			}()
			return next(ctx, req)
		}
	}
}
