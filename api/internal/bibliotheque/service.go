// Package bibliotheque sert la bibliothèque d'exercices : une table
// `library_entries`, UNE PAR STRUCTURE, unique par (structure, catégorie, nom).
// La lecture est ouverte à tout membre ; l'écriture au coach, dans SA structure.
//
// Un RPC par geste (renommer, marquer, définir les soutiens) : le tri-état par
// champ du PATCH REST n'existe plus, et « vider » ne se confond plus avec
// « ne pas toucher ».
package bibliotheque

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	bibliothequev1 "hodos/api/gen/hodos/bibliotheque/v1"
	"hodos/api/internal/db"
	"hodos/api/internal/socle"
)

var categories = map[bibliothequev1.Categorie]db.LibraryCategory{
	bibliothequev1.Categorie_CATEGORIE_EXERCICES:   db.LibraryCategoryExercices,
	bibliothequev1.Categorie_CATEGORIE_VARIANTES:   db.LibraryCategoryVariantes,
	bibliothequev1.Categorie_CATEGORIE_ASSISTANCES: db.LibraryCategoryAssistances,
	bibliothequev1.Categorie_CATEGORIE_TEMPOS:      db.LibraryCategoryTempos,
	bibliothequev1.Categorie_CATEGORIE_FORMATS:     db.LibraryCategoryFormats,
}

// Les groupes soutenus, tels que la base les épelle (`library_entries_supports`).
var groupes = map[bibliothequev1.Groupe]string{
	bibliothequev1.Groupe_GROUPE_MU:  "MU",
	bibliothequev1.Groupe_GROUPE_PU:  "PU",
	bibliothequev1.Groupe_GROUPE_DIP: "DIP",
	bibliothequev1.Groupe_GROUPE_SQ:  "SQ",
}

var groupesInverse = func() map[string]bibliothequev1.Groupe {
	m := map[string]bibliothequev1.Groupe{}
	for g, s := range groupes {
		m[s] = g
	}
	return m
}()

// Service implémente BibliothequeServiceHandler.
type Service struct {
	q    *db.Queries
	autz socle.Autz
}

// Nouveau branche le service sur le pool.
func Nouveau(pool *pgxpool.Pool) *Service {
	q := db.New(pool)
	return &Service{q: q, autz: socle.Autz{Q: q}}
}

func uuidTexte(u pgtype.UUID) string {
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func versGroupes(colonne []string) []bibliothequev1.Groupe {
	out := make([]bibliothequev1.Groupe, 0, len(colonne))
	for _, s := range colonne {
		if g, ok := groupesInverse[s]; ok {
			out = append(out, g)
		}
	}
	return out
}

// versColonne : la liste du contrat vers la colonne. ⚠️ Le VIDE devient NULL —
// la base refuse `[]` (`library_entries_supports`), et « ne soutient rien » n'a
// qu'une seule forme.
func versColonne(liste []bibliothequev1.Groupe) []string {
	if len(liste) == 0 {
		return nil
	}
	out := make([]string, 0, len(liste))
	for _, g := range liste {
		out = append(out, groupes[g])
	}
	return out
}

// LireBibliotheque : toute la bibliothèque d'une structure, groupée par
// catégorie, les cinq listes toujours présentes.
func (s *Service) LireBibliotheque(ctx context.Context, req *connect.Request[bibliothequev1.LireBibliothequeRequest]) (*connect.Response[bibliothequev1.LireBibliothequeResponse], error) {
	uid, err := s.autz.Membre(ctx)
	if err != nil {
		return nil, err
	}
	structure, err := s.autz.StructureLue(ctx, uid, req.Msg.Structure)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.BibliothequeDe(ctx, structure)
	if err != nil {
		return nil, socle.Interne(err)
	}
	res := &bibliothequev1.LireBibliothequeResponse{}
	for _, r := range rows {
		e := &bibliothequev1.Entree{
			Id: uuidTexte(r.ID), Name: r.Name, Competition: r.Competition, Supports: versGroupes(r.Supports),
		}
		switch r.Category {
		case db.LibraryCategoryExercices:
			res.Exercices = append(res.Exercices, e)
		case db.LibraryCategoryVariantes:
			res.Variantes = append(res.Variantes, e)
		case db.LibraryCategoryAssistances:
			res.Assistances = append(res.Assistances, e)
		case db.LibraryCategoryTempos:
			res.Tempos = append(res.Tempos, e)
		case db.LibraryCategoryFormats:
			res.Formats = append(res.Formats, e)
		}
	}
	return connect.NewResponse(res), nil
}

func nomPropre(name string) (string, error) {
	nom := strings.TrimSpace(name)
	if nom == "" {
		return "", socle.Metier("corps_invalide", "name ne peut pas être vide")
	}
	return nom, nil
}

// CreerEntree crée une entrée dans la bibliothèque de la structure du coach.
func (s *Service) CreerEntree(ctx context.Context, req *connect.Request[bibliothequev1.CreerEntreeRequest]) (*connect.Response[bibliothequev1.CreerEntreeResponse], error) {
	uid, err := s.autz.Coach(ctx)
	if err != nil {
		return nil, err
	}
	categorie, ok := categories[req.Msg.Categorie]
	if !ok {
		return nil, socle.Metier("corps_invalide", "catégorie inconnue")
	}
	nom, err := nomPropre(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	if req.Msg.Competition && categorie != db.LibraryCategoryExercices {
		return nil, socle.Metier("competition_hors_exercices", "competition réservé à la catégorie 'exercices'")
	}
	structure, err := s.autz.StructureEcrite(ctx, uid, req.Msg.Structure)
	if err != nil {
		return nil, err
	}
	id, err := s.q.CreerEntree(ctx, db.CreerEntreeParams{
		Dans: structure, Categorie: categorie, Nom: nom, Competition: req.Msg.Competition,
		Supports: versColonne(req.Msg.Supports), CreatedBy: &uid,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, socle.Metier("entree_deja_existante", "une entrée (catégorie, nom) identique existe déjà")
	}
	if err != nil {
		return nil, socle.Interne(err)
	}
	texte := uuidTexte(id)
	socle.Audit(ctx, "library_entry", "library/entries/"+texte, []string{"category", "name", "competition"})
	return connect.NewResponse(&bibliothequev1.CreerEntreeResponse{Id: texte}), nil
}

type entree struct {
	id  pgtype.UUID
	row db.EntreeParIdRow
}

// entreeDuCoach : l'entrée, si elle existe ET qu'elle est de la structure du
// coach. Celle d'une AUTRE structure n'existe pas pour lui (not_found, pas
// permission_denied) : la renommer propagerait aux lignes d'athlètes qu'il ne
// suit pas. L'admin voit tout.
func (s *Service) entreeDuCoach(ctx context.Context, uid, id string) (entree, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return entree{}, socle.Metier("entree_introuvable", "entrée introuvable")
	}
	row, err := s.q.EntreeParId(ctx, u)
	if errors.Is(err, pgx.ErrNoRows) {
		return entree{}, socle.Metier("entree_introuvable", "entrée introuvable")
	}
	if err != nil {
		return entree{}, socle.Interne(err)
	}
	sienne, err := s.q.StructureDuCoach(ctx, uid)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return entree{}, socle.Interne(err)
	}
	if row.Structure != sienne {
		admin, err := s.autz.Admin(ctx, uid)
		if err != nil {
			return entree{}, err
		}
		if !admin {
			return entree{}, socle.Metier("entree_introuvable", "entrée introuvable")
		}
	}
	return entree{id: u, row: row}, nil
}

// RenommerEntree renomme, et refuse un nom déjà pris dans la même catégorie.
func (s *Service) RenommerEntree(ctx context.Context, req *connect.Request[bibliothequev1.RenommerEntreeRequest]) (*connect.Response[bibliothequev1.RenommerEntreeResponse], error) {
	uid, err := s.autz.Coach(ctx)
	if err != nil {
		return nil, err
	}
	nom, err := nomPropre(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	e, err := s.entreeDuCoach(ctx, uid, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if nom != e.row.Name {
		pris, err := s.q.NomDejaPris(ctx, db.NomDejaPrisParams{
			Dans: e.row.Structure, Categorie: e.row.Category, Nom: nom, ID: e.id,
		})
		if err != nil {
			return nil, socle.Interne(err)
		}
		if pris {
			return nil, socle.Metier("entree_deja_existante", "une entrée (catégorie, nom) identique existe déjà")
		}
	}
	if err := s.q.RenommerEntree(ctx, db.RenommerEntreeParams{Nom: nom, ID: e.id}); err != nil {
		return nil, socle.Interne(err)
	}
	socle.Audit(ctx, "library_entry", "library/entries/"+req.Msg.Id, []string{"name"})
	return connect.NewResponse(&bibliothequev1.RenommerEntreeResponse{}), nil
}

// MarquerCompetition marque ou démarque un exercice ; refusé hors exercices.
func (s *Service) MarquerCompetition(ctx context.Context, req *connect.Request[bibliothequev1.MarquerCompetitionRequest]) (*connect.Response[bibliothequev1.MarquerCompetitionResponse], error) {
	uid, err := s.autz.Coach(ctx)
	if err != nil {
		return nil, err
	}
	e, err := s.entreeDuCoach(ctx, uid, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if req.Msg.Competition && e.row.Category != db.LibraryCategoryExercices {
		return nil, socle.Metier("competition_hors_exercices", "competition réservé à la catégorie 'exercices'")
	}
	if err := s.q.MarquerCompetition(ctx, db.MarquerCompetitionParams{Competition: req.Msg.Competition, ID: e.id}); err != nil {
		return nil, socle.Interne(err)
	}
	socle.Audit(ctx, "library_entry", "library/entries/"+req.Msg.Id, []string{"competition"})
	return connect.NewResponse(&bibliothequev1.MarquerCompetitionResponse{}), nil
}

// DefinirSupports remplace les groupes soutenus ; une liste vide vide l'entrée.
func (s *Service) DefinirSupports(ctx context.Context, req *connect.Request[bibliothequev1.DefinirSupportsRequest]) (*connect.Response[bibliothequev1.DefinirSupportsResponse], error) {
	uid, err := s.autz.Coach(ctx)
	if err != nil {
		return nil, err
	}
	e, err := s.entreeDuCoach(ctx, uid, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if err := s.q.DefinirSupports(ctx, db.DefinirSupportsParams{Supports: versColonne(req.Msg.Supports), ID: e.id}); err != nil {
		return nil, socle.Interne(err)
	}
	socle.Audit(ctx, "library_entry", "library/entries/"+req.Msg.Id, []string{"supports"})
	return connect.NewResponse(&bibliothequev1.DefinirSupportsResponse{}), nil
}
