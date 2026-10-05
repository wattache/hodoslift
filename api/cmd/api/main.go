// sindri — le frère de brokkr : le même produit, en Go, servi en Connect.
// Il naît domaine par domaine ; brokkr garde le reste.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"hodos/api/gen/hodos/bibliotheque/v1/bibliothequev1connect"
	"hodos/api/internal/bibliotheque"
	"hodos/api/internal/socle"
)

func main() {
	socle.InstallerJournal()
	cfg := socle.Charger()
	vider := socle.InstallerSentry(cfg)
	defer vider()

	ctx, arreter := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer arreter()

	pool, err := socle.OuvrirPool(ctx, cfg)
	if err != nil {
		slog.Error("Postgres : pool refusé", "erreur", err.Error())
		os.Exit(1)
	}
	defer pool.Close()

	verifieur, err := socle.NouveauVerifieurFirebase(ctx, cfg.ProjectID)
	if err != nil {
		slog.Error("Firebase : Admin SDK refusé", "erreur", err.Error())
		os.Exit(1)
	}
	validation, err := socle.InterceptorValidation()
	if err != nil {
		slog.Error("protovalidate refusé", "erreur", err.Error())
		os.Exit(1)
	}
	// L'ordre compte : le filet enveloppe tout, puis qui appelle, puis la forme.
	intercepteurs := connect.WithInterceptors(socle.Filet(), socle.InterceptorAuth(verifieur), validation)

	mux := http.NewServeMux()
	mux.Handle("/health", socle.Sante(cfg, pool))
	mux.Handle("/health/", socle.Sante(cfg, pool))
	mux.Handle(bibliothequev1connect.NewBibliothequeServiceHandler(bibliotheque.Nouveau(pool), intercepteurs))

	serveur := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           socle.AvecRequestID(socle.CORS(cfg)(h2c.NewHandler(mux, &http2.Server{}))),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		fin, annuler := context.WithTimeout(context.Background(), 10*time.Second)
		defer annuler()
		_ = serveur.Shutdown(fin)
	}()
	slog.Info("sindri écoute", "port", cfg.Port, "version", cfg.VersionDeployee())
	if err := serveur.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serveur arrêté", "erreur", err.Error())
		os.Exit(1)
	}
}
