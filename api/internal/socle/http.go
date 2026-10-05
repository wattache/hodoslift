package socle

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	connectcors "connectrpc.com/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/cors"
)

var localhost = regexp.MustCompile(`^http://localhost:\d+$`)

// CORS : les origines de production, plus localhost sur un poste de
// développement seulement. `Authorization` s'ajoute aux en-têtes de Connect.
func CORS(cfg Config) func(http.Handler) http.Handler {
	origines := map[string]bool{}
	for _, o := range cfg.AllowedOrigins {
		origines[o] = true
	}
	return cors.New(cors.Options{
		AllowOriginFunc: func(origine string) bool {
			return origines[origine] || (cfg.Local() && localhost.MatchString(origine))
		},
		AllowedMethods:   connectcors.AllowedMethods(),
		AllowedHeaders:   append(connectcors.AllowedHeaders(), "Authorization"),
		ExposedHeaders:   append(connectcors.ExposedHeaders(), "X-Request-Id"),
		AllowCredentials: true,
		MaxAge:           7200,
	}).Handler
}

func repondreJSON(w http.ResponseWriter, statut int, corps any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statut)
	_ = json.NewEncoder(w).Encode(corps)
}

// Sante : `/health` (liveness, public, rend la version — la seule façon de
// savoir ce qui TOURNE) et `/health/db` (readiness, rend les bornes de session
// telles que le processus les reçoit, que `make verifier` compare).
func Sante(cfg Config, pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		var version any
		if v := cfg.VersionDeployee(); v != "" {
			version = v
		}
		repondreJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "api", "version": version})
	})
	mux.HandleFunc("GET /health/db", func(w http.ResponseWriter, r *http.Request) {
		ctx, annuler := context.WithTimeout(r.Context(), 5*time.Second)
		defer annuler()
		bornes := map[string]string{}
		for reglage := range BornesDuRole {
			var valeur string
			if err := pool.QueryRow(ctx, "SELECT current_setting($1)", reglage).Scan(&valeur); err != nil {
				repondreJSON(w, http.StatusServiceUnavailable, map[string]any{
					"code": "base_injoignable", "detail": "base de données injoignable", "status": 503})
				return
			}
			bornes[reglage] = valeur
		}
		repondreJSON(w, http.StatusOK, map[string]any{"ok": true, "bornes": bornes})
	})
	return mux
}
