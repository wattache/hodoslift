package socle

import (
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/getsentry/sentry-go"

	soclev1 "hodos/api/gen/hodos/socle/v1"
)

// Codes est le vocabulaire CLOS des erreurs métier, un sous-ensemble de
// `CODES` dans brokkr (`app/socle/erreurs.py`), avec le même statut HTTP :
// eitri traduit le code à l'écran, et la grille doit être la même des deux
// côtés tant que les deux serveurs vivent.
var Codes = map[string]int{
	"erreur_interne":             500,
	"base_injoignable":           503,
	"token_invalide":             401,
	"reserve_aux_membres":        403,
	"reserve_aux_coachs":         403,
	"corps_invalide":             422,
	"structure_inconnue":         404,
	"entree_introuvable":         404,
	"entree_deja_existante":      409,
	"competition_hors_exercices": 422,
}

var codeConnect = map[int]connect.Code{
	401: connect.CodeUnauthenticated,
	403: connect.CodePermissionDenied,
	404: connect.CodeNotFound,
	409: connect.CodeAlreadyExists,
	422: connect.CodeInvalidArgument,
	500: connect.CodeInternal,
	503: connect.CodeUnavailable,
}

// Metier construit l'erreur d'un geste refusé : le code Connect la classe, le
// détail `Erreur{code, detail, status}` porte le mot du vocabulaire. Un code
// hors vocabulaire est une faute de programmation, pas une erreur d'exécution.
func Metier(code, detail string) *connect.Error {
	status, ok := Codes[code]
	if !ok {
		panic(fmt.Sprintf("code d'erreur hors vocabulaire : %q", code))
	}
	err := connect.NewError(codeConnect[status], errors.New(detail))
	if d, e := connect.NewErrorDetail(&soclev1.Erreur{Code: code, Detail: detail, Status: int32(status)}); e == nil {
		err.AddDetail(d)
	}
	return err
}

// Interne : ce qui ne devait pas arriver. Journalisé, envoyé à Sentry, et rendu
// sous la forme unique — le détail ne sort jamais, il pourrait porter du SQL.
func Interne(err error) *connect.Error {
	slog.Error("erreur interne", "erreur", err.Error())
	sentry.CaptureException(err)
	return Metier("erreur_interne", "Le serveur a rencontré une erreur imprévue.")
}

// CodeDe lit le code métier d'une erreur, ou "" si elle n'en porte pas.
func CodeDe(err error) string {
	var ce *connect.Error
	if !errors.As(err, &ce) {
		return ""
	}
	for _, d := range ce.Details() {
		msg, e := d.Value()
		if e != nil {
			continue
		}
		if er, ok := msg.(*soclev1.Erreur); ok {
			return er.GetCode()
		}
	}
	return ""
}
