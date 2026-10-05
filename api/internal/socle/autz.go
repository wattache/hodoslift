package socle

import (
	"context"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"

	"hodos/api/internal/db"
)

// Premiere est la structure de l'existant. Elle sert à ORDONNER, jamais de
// valeur par défaut d'une écriture : chaque chemin nomme la sienne.
const Premiere = "french-forge"

// Autz répond « qui est quoi ». La résolution uid → rôles vit ici et nulle part
// ailleurs (`app/socle/authz.py`, FRE-64) : un domaine consomme, il ne
// recompose pas.
type Autz struct{ Q *db.Queries }

// Membre : un lien RÉEL avec l'application — un rôle, ou une fiche athlète.
// Firebase accepte tout compte Google ; authentifié n'est pas membre (FRE-78).
func (a Autz) Membre(ctx context.Context) (string, error) {
	uid := UID(ctx)
	ok, err := a.Q.EstMembre(ctx, uid)
	if err != nil {
		return "", Interne(err)
	}
	if !ok {
		return "", Metier("reserve_aux_membres", "compte sans lien avec l'application")
	}
	return uid, nil
}

// Coach : une ligne dans `coaches`. Être coach, c'est avoir une ligne.
func (a Autz) Coach(ctx context.Context) (string, error) {
	uid := UID(ctx)
	ok, err := a.Q.EstCoach(ctx, uid)
	if err != nil {
		return "", Interne(err)
	}
	if !ok {
		return "", Metier("reserve_aux_coachs", "réservé aux coachs")
	}
	return uid, nil
}

// Admin : `users.is_admin`, faux si aucune ligne.
func (a Autz) Admin(ctx context.Context, uid string) (bool, error) {
	ok, err := a.Q.EstAdmin(ctx, uid)
	if err != nil {
		return false, Interne(err)
	}
	return ok, nil
}

// SlugsDe : les structures de ce compte — celles où il coache, exerce, a sa
// fiche, ou toutes s'il est admin.
func (a Autz) SlugsDe(ctx context.Context, uid string) (map[string]bool, error) {
	rows, err := a.Q.StructuresDe(ctx, db.StructuresDeParams{Compte: uid, Premiere: Premiere})
	if err != nil {
		return nil, Interne(err)
	}
	slugs := map[string]bool{}
	for _, r := range rows {
		if r.EstAdmin || r.EstCoach || r.EstKine || r.EstAthlete {
			slugs[r.Slug] = true
		}
	}
	return slugs, nil
}

// StructureLue : la bibliothèque qu'on LIT — celle demandée, si le compte en
// est. Hors de ses structures, elle n'existe pas : not_found, pas
// permission_denied, qui mentirait sur la cause. Sans demande : la première du
// compte, `Premiere` d'abord.
func (a Autz) StructureLue(ctx context.Context, uid string, demandee *string) (string, error) {
	siennes, err := a.SlugsDe(ctx, uid)
	if err != nil {
		return "", err
	}
	if demandee == nil {
		if siennes[Premiere] || len(siennes) == 0 {
			return Premiere, nil
		}
		tri := make([]string, 0, len(siennes))
		for s := range siennes {
			tri = append(tri, s)
		}
		sort.Strings(tri)
		return tri[0], nil
	}
	if !siennes[*demandee] {
		return "", Metier("structure_inconnue", "pas une structure de ce compte")
	}
	return *demandee, nil
}

// StructureEcrite : où une ÉCRITURE de coach se range. Celle où l'on coache,
// sauf l'admin, qui écrit dans celle qu'il nomme : il administre la structure
// qu'il regarde, et n'y coache pas forcément.
func (a Autz) StructureEcrite(ctx context.Context, uid string, demandee *string) (string, error) {
	sienne, err := a.Q.StructureDuCoach(ctx, uid)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", Interne(err)
	}
	if demandee == nil || *demandee == sienne {
		return sienne, nil
	}
	admin, err := a.Admin(ctx, uid)
	if err != nil {
		return "", err
	}
	if admin {
		return *demandee, nil
	}
	return "", Metier("reserve_aux_coachs", "on n'écrit que dans la structure où l'on coache")
}
