package socle

import (
	"context"
	"strings"
	"testing"
)

// sindri vérifie un jeton Firebase sans aucun identifiant Google : hors de GCP,
// il n'y a ni compte de service ni identifiants par défaut (ADC). Aucun appel
// réseau : on s'arrête à la construction du client, là où l'ADC était exigé.
func TestLeVerifieurSeConstruitSansIdentifiantsGoogle(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // pas de ~/.config/gcloud
	for _, v := range []string{"GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_AUTH_EMULATOR_HOST", "GOOGLE_CLOUD_PROJECT", "CLOUDSDK_CONFIG"} {
		t.Setenv(v, "")
	}
	// MUTATION QUI ROUGIT : retirer `option.WithoutAuthentication()` — le SDK
	// réclame l'ADC, sindri ne démarre plus hors de GCP.
	if _, err := NouveauVerifieurFirebase(context.Background(), "french-forge-600"); err != nil {
		t.Fatalf("le vérifieur exige des identifiants Google : %v", err)
	}
}

func TestLesOriginesSeLisentDansLEnvironnement(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", `["https://trainer.french-forge.com","http://localhost:5173"]`)
	if o := Charger().AllowedOrigins; len(o) != 2 || o[1] != "http://localhost:5173" {
		t.Fatalf("origines lues : %v", o)
	}
	// Illisible : la production seule, jamais plus large.
	t.Setenv("ALLOWED_ORIGINS", `localhost`)
	if o := Charger().AllowedOrigins; len(o) != 2 || o[0] != "https://trainer.french-forge.com" || o[1] != "https://french-forge.com" {
		t.Fatalf("origines de repli : %v", o)
	}
}

func TestLePortDeLaBaseEntreDansLURL(t *testing.T) {
	c := Config{DBHost: "10.0.0.4", DBPort: "15432", DBUser: "brokkr_app", DBPassword: "x", DBName: "ff"}
	if u := c.URLPostgres(); !strings.Contains(u, "@10.0.0.4:15432/ff") {
		t.Fatalf("URL sans le port : %s", u)
	}
}
