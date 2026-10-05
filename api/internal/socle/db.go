package socle

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BornesDuRole : ce que chaque session Postgres doit recevoir. Elles vivent sur
// le rôle (`ALTER ROLE … SET`) ; on les repasse ici à l'ouverture, et
// `/health/db` rend ce que le processus reçoit VRAIMENT, par le chemin qu'il
// emprunte. L'endpoint DIRECT, pas le pooler, qui ne les propage pas.
var BornesDuRole = map[string]string{
	"statement_timeout": "15s",
	"lock_timeout":      "5s",
	"TimeZone":          "Europe/Paris",
}

// OuvrirPool ouvre le pool pgx : sept sockets au plus par instance, recyclées
// toutes les cinq minutes (Neon met en veille les connexions idle).
func OuvrirPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(cfg.URLPostgres())
	if err != nil {
		return nil, err
	}
	pc.MaxConns = 7
	pc.MaxConnLifetime = 5 * time.Minute
	pc.HealthCheckPeriod = time.Minute
	pc.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	pc.ConnConfig.RuntimeParams["lock_timeout"] = "5000"
	pc.ConnConfig.RuntimeParams["timezone"] = "Europe/Paris"
	return pgxpool.NewWithConfig(ctx, pc)
}
