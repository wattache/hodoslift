package socle

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

// Verifieur dit à qui appartient un jeton. En production, Firebase ; dans les
// tests, une table. `verify_id_token` de brokkr, sans `check_revoked` : une
// signature contre les clés publiques de Google, aucun appel autorisé.
type Verifieur interface {
	Verifier(ctx context.Context, jeton string) (uid string, err error)
}

type verifieurFirebase struct{ client *auth.Client }

// NouveauVerifieurFirebase branche l'Admin SDK, SANS identité Google.
//
// ⚠️ `VerifyIDToken` valide une signature contre les clés PUBLIQUES de Google :
// il n'appelle aucune API autorisée. Sans `WithoutAuthentication`, le SDK
// exigerait des identifiants par défaut (ADC), qui n'existent que sur GCP — et
// sindri tourne ailleurs. Le client se construit ICI, au démarrage : un échec se
// voit au lancement, pas comme un 401 sur chaque requête.
func NouveauVerifieurFirebase(ctx context.Context, projectID string) (Verifieur, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID}, option.WithoutAuthentication())
	if err != nil {
		return nil, err
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return verifieurFirebase{client: client}, nil
}

func (v verifieurFirebase) Verifier(ctx context.Context, jeton string) (string, error) {
	t, err := v.client.VerifyIDToken(ctx, jeton)
	if err != nil {
		return "", err
	}
	return t.UID, nil
}

// VerifieurFixe : jeton → uid, pour les tests. Un jeton absent de la table est
// invalide.
type VerifieurFixe map[string]string

func (v VerifieurFixe) Verifier(_ context.Context, jeton string) (string, error) {
	if uid, ok := v[jeton]; ok {
		return uid, nil
	}
	return "", Metier("token_invalide", "jeton inconnu")
}

type cleUID struct{}

// UID est l'appelant authentifié, posé par InterceptorAuth. Vide hors de lui.
func UID(ctx context.Context) string {
	uid, _ := ctx.Value(cleUID{}).(string)
	return uid
}

// InterceptorAuth exige `Authorization: Bearer <jeton>` sur CHAQUE appel, et
// pose l'uid dans le contexte. Authentifié n'est pas membre : c'est Autz qui
// tranche ensuite.
func InterceptorAuth(v Verifieur) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			entete := req.Header().Get("Authorization")
			if !strings.HasPrefix(entete, "Bearer ") {
				return nil, Metier("token_invalide", "Jeton absent, expiré ou illisible.")
			}
			uid, err := v.Verifier(ctx, strings.TrimPrefix(entete, "Bearer "))
			if err != nil || uid == "" {
				return nil, Metier("token_invalide", "Jeton absent, expiré ou illisible.")
			}
			return next(context.WithValue(ctx, cleUID{}, uid), req)
		}
	}
}
