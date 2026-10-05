package bibliotheque_test

// Un Postgres 16 — la version de Neon — dont le schéma est créé DEPUIS
// `api-python/docs/postgres-schema.sql`, comme les tests de brokkr : sa dérive
// devient un test rouge ici aussi. Le conteneur est VIDE hors schéma ; chaque
// test sème ce dont il a besoin.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	bibliothequev1 "hodos/api/gen/hodos/bibliotheque/v1"
	"hodos/api/gen/hodos/bibliotheque/v1/bibliothequev1connect"
	"hodos/api/internal/bibliotheque"
	"hodos/api/internal/socle"
)

var (
	pool   *pgxpool.Pool
	client bibliothequev1connect.BibliothequeServiceClient
)

// Les jetons du harnais : chacun désigne un compte semé dans TestMain.
const (
	jetonCoachFF  = "coach-ff"    // coache à french-forge
	jetonCoachSC  = "coach-sc"    // coache à scappulift
	jetonAthlete  = "athlete"     // membre par sa fiche, pas coach
	jetonAdmin    = "admin-coach" // admin ET coach à french-forge
	jetonEtranger = "etranger"    // compte Google sans lien avec le club
	jetonInconnu  = "inconnu"     // aucun compte
	structureFF   = "french-forge"
	structureSC   = "scappulift"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:16",
		postgres.WithDatabase("ff"), postgres.WithUsername("postgres"), postgres.WithPassword("local"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
			WithOccurrence(2).WithStartupTimeout(90*time.Second)))
	if err != nil {
		panic(err)
	}
	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		panic(err)
	}
	pool, err = pgxpool.New(ctx, url)
	if err != nil {
		panic(err)
	}
	schema, err := os.ReadFile(filepath.Join("..", "..", "..", "api-python", "docs", "postgres-schema.sql"))
	if err != nil {
		panic(err)
	}
	if _, err := pool.Exec(ctx, string(schema)); err != nil {
		panic("schéma brokkr refusé : " + err.Error())
	}
	semer := []string{
		"INSERT INTO structures (slug, nom) VALUES ('scappulift', 'SCAPPULIFT') ON CONFLICT DO NOTHING",
		"INSERT INTO users (uid, email) VALUES ('coach-ff','a@t'), ('coach-sc','b@t'), ('athlete','c@t'), ('admin-coach','d@t'), ('etranger','e@t')",
		"UPDATE users SET is_admin = true WHERE uid = 'admin-coach'",
		"INSERT INTO coaches (uid, structure) VALUES ('coach-ff','french-forge'), ('coach-sc','scappulift'), ('admin-coach','french-forge')",
		"INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, email, user_uid) VALUES ('e2e0e2e0-0000-4000-8000-000000000009', 'ath-1', 'coach-ff', 'A', 'B', 'c@t', 'athlete')",
	}
	for _, s := range semer {
		if _, err := pool.Exec(ctx, s); err != nil {
			panic(s + " : " + err.Error())
		}
	}
	validation, err := socle.InterceptorValidation()
	if err != nil {
		panic(err)
	}
	jetons := socle.VerifieurFixe{}
	for _, j := range []string{jetonCoachFF, jetonCoachSC, jetonAthlete, jetonAdmin, jetonEtranger} {
		jetons[j] = j
	}
	mux := http.NewServeMux()
	mux.Handle(bibliothequev1connect.NewBibliothequeServiceHandler(bibliotheque.Nouveau(pool),
		connect.WithInterceptors(socle.Filet(), socle.InterceptorAuth(jetons), validation)))
	srv := httptest.NewServer(mux)
	client = bibliothequev1connect.NewBibliothequeServiceClient(srv.Client(), srv.URL)

	code := m.Run()
	srv.Close()
	pool.Close()
	_ = ctr.Terminate(ctx)
	os.Exit(code)
}

func avec[T any](jeton string, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+jeton)
	return req
}

func ptr(s string) *string { return &s }

// attendre vérifie le code Connect ET le mot du vocabulaire métier.
func attendre(t *testing.T, err error, code connect.Code, metier string) {
	t.Helper()
	if err == nil {
		t.Fatalf("attendu %s/%s, reçu un succès", code, metier)
	}
	if connect.CodeOf(err) != code || socle.CodeDe(err) != metier {
		t.Fatalf("attendu %s/%s, reçu %s/%s (%v)", code, metier, connect.CodeOf(err), socle.CodeDe(err), err)
	}
}

func creer(t *testing.T, jeton string, cat bibliothequev1.Categorie, nom string, opts ...func(*bibliothequev1.CreerEntreeRequest)) string {
	t.Helper()
	req := &bibliothequev1.CreerEntreeRequest{Categorie: cat, Name: nom}
	for _, o := range opts {
		o(req)
	}
	res, err := client.CreerEntree(context.Background(), avec(jeton, req))
	if err != nil {
		t.Fatalf("création %q : %v", nom, err)
	}
	return res.Msg.Id
}

func lire(t *testing.T, jeton string, structure *string) *bibliothequev1.LireBibliothequeResponse {
	t.Helper()
	res, err := client.LireBibliotheque(context.Background(), avec(jeton, &bibliothequev1.LireBibliothequeRequest{Structure: structure}))
	if err != nil {
		t.Fatalf("lecture : %v", err)
	}
	return res.Msg
}

func trouver(liste []*bibliothequev1.Entree, id string) *bibliothequev1.Entree {
	for _, e := range liste {
		if e.Id == id {
			return e
		}
	}
	return nil
}

func supportsEnBase(t *testing.T, id string) []string {
	t.Helper()
	var s []string
	if err := pool.QueryRow(context.Background(), "SELECT supports FROM library_entries WHERE CAST(id AS text) = $1", id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLectureGroupeeParCategorie(t *testing.T) {
	exo := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_EXERCICES, "Lecture Exo",
		func(r *bibliothequev1.CreerEntreeRequest) { r.Competition = true })
	tempo := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_TEMPOS, "Lecture Tempo")
	ren := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_ASSISTANCES, "Lecture Renfo",
		func(r *bibliothequev1.CreerEntreeRequest) {
			r.Supports = []bibliothequev1.Groupe{bibliothequev1.Groupe_GROUPE_MU, bibliothequev1.Groupe_GROUPE_PU}
		})
	lib := lire(t, jetonCoachFF, nil)
	if e := trouver(lib.Exercices, exo); e == nil || !e.Competition {
		t.Fatalf("l'exercice manque ou n'est pas de compétition : %v", e)
	}
	if trouver(lib.Tempos, tempo) == nil {
		t.Fatal("le tempo manque")
	}
	if e := trouver(lib.Assistances, ren); e == nil || len(e.Supports) != 2 {
		t.Fatalf("le renforcement manque ou a perdu ses soutiens : %v", e)
	}
}

func TestLectureOuverteAuMembreNonCoach(t *testing.T) {
	lire(t, jetonAthlete, nil)
}

func TestLectureRefuseeSansLienAvecLeClub(t *testing.T) {
	_, err := client.LireBibliotheque(context.Background(), avec(jetonEtranger, &bibliothequev1.LireBibliothequeRequest{}))
	attendre(t, err, connect.CodePermissionDenied, "reserve_aux_membres")
}

func TestSansJeton(t *testing.T) {
	_, err := client.LireBibliotheque(context.Background(), connect.NewRequest(&bibliothequev1.LireBibliothequeRequest{}))
	attendre(t, err, connect.CodeUnauthenticated, "token_invalide")
	_, err = client.LireBibliotheque(context.Background(), avec(jetonInconnu, &bibliothequev1.LireBibliothequeRequest{}))
	attendre(t, err, connect.CodeUnauthenticated, "token_invalide")
}

func TestLectureDUneStructureQuiNEstPasLaSienne(t *testing.T) {
	_, err := client.LireBibliotheque(context.Background(), avec(jetonCoachFF, &bibliothequev1.LireBibliothequeRequest{Structure: ptr(structureSC)}))
	attendre(t, err, connect.CodeNotFound, "structure_inconnue")
	// L'admin, lui, lit toutes les structures.
	lire(t, jetonAdmin, ptr(structureSC))
}

func TestCreationTrimEtDoublon(t *testing.T) {
	id := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_VARIANTES, "  Strict E2E  ")
	lib := lire(t, jetonCoachFF, nil)
	if e := trouver(lib.Variantes, id); e == nil || e.Name != "Strict E2E" {
		t.Fatalf("nom non normalisé : %v", e)
	}
	_, err := client.CreerEntree(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.CreerEntreeRequest{Categorie: bibliothequev1.Categorie_CATEGORIE_VARIANTES, Name: "Strict E2E"}))
	attendre(t, err, connect.CodeAlreadyExists, "entree_deja_existante")
	// Même nom, autre catégorie : deux entrées distinctes.
	creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_FORMATS, "Strict E2E")
	// Même nom, AUTRE structure : la bibliothèque est par structure.
	creer(t, jetonCoachSC, bibliothequev1.Categorie_CATEGORIE_VARIANTES, "Strict E2E")
}

func TestCreationRefuseeAuNonCoach(t *testing.T) {
	_, err := client.CreerEntree(context.Background(), avec(jetonAthlete,
		&bibliothequev1.CreerEntreeRequest{Categorie: bibliothequev1.Categorie_CATEGORIE_TEMPOS, Name: "3-0-1"}))
	attendre(t, err, connect.CodePermissionDenied, "reserve_aux_coachs")
}

func TestCompetitionHorsExercices(t *testing.T) {
	_, err := client.CreerEntree(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.CreerEntreeRequest{Categorie: bibliothequev1.Categorie_CATEGORIE_TEMPOS, Name: "Tempo compét", Competition: true}))
	attendre(t, err, connect.CodeInvalidArgument, "competition_hors_exercices")
	id := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_TEMPOS, "Tempo marqué")
	_, err = client.MarquerCompetition(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.MarquerCompetitionRequest{Id: id, Competition: true}))
	attendre(t, err, connect.CodeInvalidArgument, "competition_hors_exercices")
}

func TestLeContratRefuseCeQuiNEstPasDedans(t *testing.T) {
	cas := map[string]*bibliothequev1.CreerEntreeRequest{
		"catégorie absente": {Name: "x"},
		"nom vide":          {Categorie: bibliothequev1.Categorie_CATEGORIE_TEMPOS, Name: ""},
		"nom blanc":         {Categorie: bibliothequev1.Categorie_CATEGORIE_TEMPOS, Name: "   "},
		"groupe indéfini":   {Categorie: bibliothequev1.Categorie_CATEGORIE_ASSISTANCES, Name: "x", Supports: []bibliothequev1.Groupe{bibliothequev1.Groupe(42)}},
		"groupe en double":  {Categorie: bibliothequev1.Categorie_CATEGORIE_ASSISTANCES, Name: "x", Supports: []bibliothequev1.Groupe{bibliothequev1.Groupe_GROUPE_MU, bibliothequev1.Groupe_GROUPE_MU}},
	}
	for nom, req := range cas {
		_, err := client.CreerEntree(context.Background(), avec(jetonCoachFF, req))
		if connect.CodeOf(err) != connect.CodeInvalidArgument || socle.CodeDe(err) != "corps_invalide" {
			t.Errorf("%s : attendu invalid_argument/corps_invalide, reçu %v", nom, err)
		}
	}
	_, err := client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: "pas-un-uuid", Name: "x"}))
	attendre(t, err, connect.CodeInvalidArgument, "corps_invalide")
}

func TestRenommer(t *testing.T) {
	a := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_EXERCICES, "Renommer A",
		func(r *bibliothequev1.CreerEntreeRequest) { r.Competition = true })
	creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_EXERCICES, "Renommer B")
	// Vers un nom pris : refusé.
	_, err := client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: a, Name: "Renommer B"}))
	attendre(t, err, connect.CodeAlreadyExists, "entree_deja_existante")
	// Vers soi-même : accepté.
	if _, err := client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: a, Name: "Renommer A"})); err != nil {
		t.Fatal(err)
	}
	// Vers un nom libre : le marqueur compétition est préservé.
	if _, err := client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: a, Name: " Renommer C "})); err != nil {
		t.Fatal(err)
	}
	e := trouver(lire(t, jetonCoachFF, nil).Exercices, a)
	if e == nil || e.Name != "Renommer C" || !e.Competition {
		t.Fatalf("renommage perdu ou marqueur perdu : %v", e)
	}
}

func TestLEntreeDUneAutreStructureNExistePas(t *testing.T) {
	id := creer(t, jetonCoachSC, bibliothequev1.Categorie_CATEGORIE_TEMPOS, "Tempo SC")
	_, err := client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: id, Name: "Vol"}))
	attendre(t, err, connect.CodeNotFound, "entree_introuvable")
	_, err = client.RenommerEntree(context.Background(), avec(jetonCoachFF, &bibliothequev1.RenommerEntreeRequest{Id: "e2e0e2e0-0000-4000-8000-0000000000ff", Name: "Rien"}))
	attendre(t, err, connect.CodeNotFound, "entree_introuvable")
	// L'admin, lui, y touche.
	if _, err := client.RenommerEntree(context.Background(), avec(jetonAdmin, &bibliothequev1.RenommerEntreeRequest{Id: id, Name: "Tempo SC bis"})); err != nil {
		t.Fatal(err)
	}
}

func TestLAdminEcritDansLaStructureQuIlNomme(t *testing.T) {
	id := creer(t, jetonAdmin, bibliothequev1.Categorie_CATEGORIE_FORMATS, "Format admin",
		func(r *bibliothequev1.CreerEntreeRequest) { r.Structure = ptr(structureSC) })
	if trouver(lire(t, jetonCoachSC, nil).Formats, id) == nil {
		t.Fatal("l'entrée n'est pas rangée dans la structure nommée")
	}
	_, err := client.CreerEntree(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.CreerEntreeRequest{Categorie: bibliothequev1.Categorie_CATEGORIE_FORMATS, Name: "Format intrus", Structure: ptr(structureSC)}))
	attendre(t, err, connect.CodePermissionDenied, "reserve_aux_coachs")
}

func TestLesSoutiensSeDefinissentEtSeVident(t *testing.T) {
	id := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_ASSISTANCES, "Soutiens")
	if s := supportsEnBase(t, id); s != nil {
		t.Fatalf("créée sans soutien, la base devrait porter NULL : %v", s)
	}
	if _, err := client.DefinirSupports(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.DefinirSupportsRequest{Id: id, Supports: []bibliothequev1.Groupe{bibliothequev1.Groupe_GROUPE_SQ}})); err != nil {
		t.Fatal(err)
	}
	if e := trouver(lire(t, jetonCoachFF, nil).Assistances, id); e == nil || len(e.Supports) != 1 || e.Supports[0] != bibliothequev1.Groupe_GROUPE_SQ {
		t.Fatalf("soutien non posé : %v", e)
	}
	// ⚠️ Vider VIDE VRAIMENT : NULL en base, pas un no-op silencieux (FRE-185).
	if _, err := client.DefinirSupports(context.Background(), avec(jetonCoachFF,
		&bibliothequev1.DefinirSupportsRequest{Id: id})); err != nil {
		t.Fatal(err)
	}
	if s := supportsEnBase(t, id); s != nil {
		t.Fatalf("vidée, la base devrait porter NULL : %v", s)
	}
}

func TestMarquerCompetition(t *testing.T) {
	id := creer(t, jetonCoachFF, bibliothequev1.Categorie_CATEGORIE_EXERCICES, "Marquer")
	if _, err := client.MarquerCompetition(context.Background(), avec(jetonCoachFF, &bibliothequev1.MarquerCompetitionRequest{Id: id, Competition: true})); err != nil {
		t.Fatal(err)
	}
	if e := trouver(lire(t, jetonCoachFF, nil).Exercices, id); e == nil || !e.Competition {
		t.Fatalf("marqueur non posé : %v", e)
	}
	if _, err := client.MarquerCompetition(context.Background(), avec(jetonCoachFF, &bibliothequev1.MarquerCompetitionRequest{Id: id})); err != nil {
		t.Fatal(err)
	}
	if e := trouver(lire(t, jetonCoachFF, nil).Exercices, id); e == nil || e.Competition {
		t.Fatalf("marqueur non retiré : %v", e)
	}
}

func TestLeVocabulaireDesErreursEstClos(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("un code hors vocabulaire devrait paniquer")
		}
	}()
	_ = socle.Metier("code_invente", "…")
}

var _ = errors.New
