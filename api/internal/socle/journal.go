package socle

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// InstallerJournal pose un journal JSON lisible par Cloud Logging : les mêmes
// clés que brokkr (`severity`, `message`, `timestamp`, `requestId`).
func InstallerJournal() {
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			switch a.Key {
			case slog.TimeKey:
				a.Key = "timestamp"
			case slog.MessageKey:
				a.Key = "message"
			case slog.LevelKey:
				a.Key = "severity"
				switch a.Value.Any().(slog.Level) {
				case slog.LevelWarn:
					a.Value = slog.StringValue("WARNING")
				case slog.LevelError:
					a.Value = slog.StringValue("ERROR")
				case slog.LevelDebug:
					a.Value = slog.StringValue("DEBUG")
				default:
					a.Value = slog.StringValue("INFO")
				}
			}
			return a
		},
	})
	slog.SetDefault(slog.New(h))
}

type cleRequete struct{}

// RequestID est l'identifiant de la requête en cours, posé par le middleware.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(cleRequete{}).(string)
	return id
}

type ecrivain struct {
	http.ResponseWriter
	statut int
}

func (e *ecrivain) WriteHeader(code int) {
	e.statut = code
	e.ResponseWriter.WriteHeader(code)
}

// Flush laisse passer le streaming de Connect.
func (e *ecrivain) Flush() {
	if f, ok := e.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// AvecRequestID pose l'identifiant de requête (celui de Cloud Trace s'il y en
// a un) dans le contexte et la réponse, et journalise la fin de chaque appel.
func AvecRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Cloud-Trace-Context")
		if i := strings.IndexByte(id, '/'); i >= 0 {
			id = id[:i]
		}
		if id == "" {
			var b [16]byte
			_, _ = rand.Read(b[:])
			id = hex.EncodeToString(b[:])
		}
		e := &ecrivain{ResponseWriter: w, statut: http.StatusOK}
		e.Header().Set("X-Request-Id", id)
		debut := time.Now()
		next.ServeHTTP(e, r.WithContext(context.WithValue(r.Context(), cleRequete{}, id)))
		slog.Info(r.Method+" "+r.URL.Path,
			"requestId", id, "status", e.statut,
			"durationMs", float64(time.Since(debut).Microseconds())/1000)
	})
}
