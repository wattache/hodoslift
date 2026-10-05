"""Un script qui écrit ne touche pas la production par mégarde (FRE-89).

⚠️ LE DÉFAUT QUE CES SPECS FERMENT. `brokkr/.env` pointe sur Neon — voulu pour
l'API locale — et les scripts en héritent : un `--commit` tapé dans le bon
dossier écrivait donc en production, sans autre sommation que le dry-run qu'on
est censé avoir lu. Le garde-fou n'existait que dans un script, supprimé depuis.

La règle : un dry-run lit où il veut ; une écriture locale passe ; une écriture
distante exige le mot `--production`, écrit à la main.
"""

import pytest

from scripts._cible import est_local, verifier_cible

_NEON = "postgresql+psycopg://brokkr:x@ep-proud-rice.eu-central-1.aws.neon.tech/ff?sslmode=require"
_LOCAL = "postgresql+psycopg://postgres:local@localhost:55433/ff"


@pytest.mark.parametrize("url, attendu", [
    (_LOCAL, True),
    ("postgresql+psycopg://u:p@127.0.0.1/ff", True),
    ("postgresql+psycopg://u:p@[::1]:5432/ff", True),
    (_NEON, False),
    ("postgresql+psycopg://u:p@db.example.com/ff", False),
])
def test_un_hote_local_se_reconnait(url, attendu):
    assert est_local(url) is attendu


def test_un_DRY_RUN_peut_viser_la_production():
    """Lire ne coûte rien : c'est même le geste attendu avant tout --commit."""
    assert verifier_cible(ecriture=False, production=False, url=_NEON).startswith("ep-proud")


def test_une_ECRITURE_locale_passe_sans_rien_demander(capsys):
    verifier_cible(ecriture=True, production=False, url=_LOCAL)
    assert "bac à sable" in capsys.readouterr().out


def test_une_ECRITURE_distante_est_REFUSEE_sans_le_mot(capsys):
    """⚠️ LA SPEC DU TICKET. `SystemExit` et non un booléen : un script qui
    continuerait après le refus est exactement ce qu'on veut rendre impossible."""
    with pytest.raises(SystemExit) as refus:
        verifier_cible(ecriture=True, production=False, url=_NEON)
    assert "ÉCRITURE REFUSÉE" in str(refus.value)
    assert "--production" in str(refus.value)


def test_le_mot_PRODUCTION_ouvre_l_ecriture_distante_et_le_dit(capsys):
    verifier_cible(ecriture=True, production=True, url=_NEON)
    assert "PRODUCTION" in capsys.readouterr().out


def test_la_cible_par_defaut_est_l_engine_REEL_pas_la_configuration(pg):
    """⚠️ Sous la fixture `pg`, `get_engine` rend la connexion du Postgres jetable.
    Le garde-fou doit regarder CELLE-LÀ — sinon il lirait Neon dans le `.env` et
    refuserait d'écrire dans le conteneur de test, ce qui casserait les specs de
    `renumber_training_tree` en `--commit`."""
    assert verifier_cible(ecriture=True, production=False) in {"localhost", "127.0.0.1"}
