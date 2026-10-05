package socle

import (
	"context"
	"log/slog"
)

// Audit émet une ligne d'audit pour une écriture médiée, requêtable par
// `jsonPayload.audit=true`. Jamais les VALEURS des champs — ce sont des données
// de santé ; seuls les noms.
func Audit(ctx context.Context, resource, docPath string, fields []string) {
	slog.Info("audit write "+resource+" "+docPath,
		"audit", true, "action", "write", "resource", resource,
		"uid", UID(ctx), "docPath", docPath, "fields", fields, "status", "ok",
		"requestId", RequestID(ctx))
}
