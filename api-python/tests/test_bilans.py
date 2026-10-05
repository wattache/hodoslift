"""Les BILANS d'un athlète — `docs/bilan-kine.md`.

⚠️ CE QUE CES SPECS GARDENT EN PRIORITÉ, dans cet ordre :

  1. LA FRONTIÈRE D'ACCÈS. Le bilan est le seul domaine dont le coach est exclu :
     il porte des antécédents et des pathologies, qui ne sont pas de la donnée
     d'entraînement (§8). Une route ajoutée distraitement en `owner_or_staff`
     ouvrirait le dossier médical à tout le staff sans qu'aucun écran ne change —
     d'où un test qui balaie TOUTES les routes plutôt que chacune la sienne.

  2. L'INSTANTANÉ (§3.1). Un bilan copie son modèle à la création. Modifier le
     modèle ensuite ne doit RIEN changer aux bilans déjà ouverts : sans cette
     garantie, une retouche légitime de la kiné réécrirait le passé en silence.
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}
_ATH = "aaaaaaaa-1111-1111-1111-111111111111"


@pytest.fixture
def monde(pg):
    """Un athlète, son coach, son kiné, un intrus — et un modèle de bilan.

    Le modèle est MINIMAL MAIS REPRÉSENTATIF : trois tests qui couvrent les trois
    formes que le domaine connaît (mesuré bilatéral, mesuré sans côté, non
    mesuré). Semer les 32 vrais tests rendrait chaque spec de finalisation
    interminable sans rien prouver de plus."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c@x.fr'), ('kine-1','k@x.fr'), "
                    "('uid-1','a@x.fr'), ('intrus','i@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, user_uid, first_name) "
        "VALUES (CAST(:a AS uuid),'a1','coach-1','kine-1','uid-1','A')"), {"a": _ATH})

    mid = pg.execute(text(
        "INSERT INTO bilan_modeles (nom) VALUES ('Bilan test') RETURNING id")).scalar()
    rid = pg.execute(text(
        "INSERT INTO bilan_rubriques (modele_id, libelle, ordre) "
        "VALUES (:m, 'Activation', 0) RETURNING id"), {"m": mid}).scalar()
    tests = {}
    for ordre, (cle, libelle, mesure, bilateral, charge) in enumerate([
        ("grip", "Grip", "secondes", True, 15),
        ("tronc", "Érecteur du rachis", "secondes", False, 40),
        ("mobilite", "Épaule — flexion", "aucune", False, None),
    ]):
        tests[cle] = str(pg.execute(text(
            "INSERT INTO bilan_tests (rubrique_id, libelle, mesure, bilateral, "
            "charge_kg, ordre) VALUES (:r, :l, :m, :b, :c, :o) RETURNING id"),
            {"r": rid, "l": libelle, "m": mesure, "b": bilateral,
             "c": charge, "o": ordre}).scalar())
    return {"pg": pg, "modele": str(mid), "rubrique": str(rid), "tests": tests}


def _creer(client, monde, date="2026-08-21", **corps):
    r = client.post("/athletes/a1/bilans", headers=_AUTH,
                    json={"date": date, "modeleId": monde["modele"], **corps})
    assert r.status_code == 201, r.text[:300]
    return r.json()


def _rattacher(monde, cle_test: str, medias: list) -> None:
    """Pose les images d'un test du modèle, dans l'ordre donné."""
    for ordre, media in enumerate(medias):
        monde["pg"].execute(text(
            "INSERT INTO bilan_test_medias (test_id, media_id, ordre) "
            "VALUES (CAST(:t AS uuid), :m, :o)"),
            {"t": monde["tests"][cle_test], "m": media, "o": ordre})


def _resultat(bilan: dict, libelle: str) -> dict:
    return next(r for r in bilan["resultats"] if r["testLibelle"] == libelle)


# --------------------------------------------------------------------------- #
# LA FRONTIÈRE D'ACCÈS — ce qui compte le plus ici
# --------------------------------------------------------------------------- #

def _toutes_les_operations(bilan: dict, modele_id: str) -> list:
    """Les SEPT opérations du domaine, corps compris. Écrite comme une fonction et
    non comme une liste figée : elle a besoin d'un bilan réel, sinon les routes qui
    en prennent l'identifiant rendraient 404 avant même d'atteindre
    l'autorisation — et le test passerait pour une raison qui n'a rien à voir."""
    b = bilan["id"]
    r = bilan["resultats"][0]["id"]
    return [
        ("get", "/athletes/a1/bilans", None),
        ("get", "/athletes/a1/bilans/modeles", None),
        ("post", "/athletes/a1/bilans", {"date": "2026-08-21", "modeleId": modele_id}),
        ("get", f"/athletes/a1/bilans/{b}", None),
        ("patch", f"/athletes/a1/bilans/{b}", {"notes": "vu par le coach"}),
        ("patch", f"/athletes/a1/bilans/{b}/resultats/{r}", {"mesureGauche": 30}),
        ("delete", f"/athletes/a1/bilans/{b}", None),
    ]


@pytest.mark.parametrize("i", range(7))
def test_le_COACH_est_refusé_sur_TOUTES_les_routes(auth_as, monde, i):
    """⚠️ LE TEST LE PLUS IMPORTANT DE CE FICHIER.

    `coach-1` gère bien cet athlète — il a accès à sa prog, son suivi, sa fiche.
    Il n'a RIEN ici, et c'est le seul endroit du produit où cette phrase est vraie.

    La règle maison veut qu'on ouvre large entre gens du staff, et elle est bonne
    pour ce qu'on programme. Elle ne peut pas décider seule de ce qui relève du
    secret médical : des antécédents et des pathologies ne sont pas de la donnée
    d'entraînement.

    Balayé sur les SEPT opérations et non sur une seule : le risque n'est pas qu'on
    se trompe une fois, c'est qu'on ajoute demain une route en `owner_or_staff` par
    habitude, et que rien ne le signale."""
    bilan = _creer(auth_as(uid="kine-1"), monde)
    methode, url, corps = _toutes_les_operations(bilan, monde["modele"])[i]

    client = auth_as(uid="coach-1")
    r = getattr(client, methode)(url, headers=_AUTH, **({"json": corps} if corps else {}))
    assert r.status_code == 403, f"{methode.upper()} {url} laisse passer le coach"
    assert r.json()["code"] == "athlete_hors_perimetre"


def test_le_KINÉ_qui_suit_l_athlète_accède(auth_as, monde):
    assert auth_as(uid="kine-1").get("/athletes/a1/bilans", headers=_AUTH).status_code == 200


def test_l_ATHLÈTE_accède_à_son_propre_bilan(auth_as, monde):
    assert auth_as(uid="uid-1").get("/athletes/a1/bilans", headers=_AUTH).status_code == 200


def test_un_QUIDAM_est_refusé(auth_as, monde):
    assert auth_as(uid="intrus").get("/athletes/a1/bilans", headers=_AUTH).status_code == 403


def test_un_KINÉ_qui_ne_suit_PAS_cet_athlète_est_refusé(auth_as, monde):
    """⚠️ C'EST LE LIEN QUI OUVRE, PAS LE RÔLE. Un kiné en règle n'a rigoureusement
    rien sur un athlète qu'il ne suit pas — la règle posée le 18/08, et elle vaut
    d'autant plus sur du médical."""
    monde["pg"].execute(text("INSERT INTO users (uid, email) VALUES ('kine-2','k2@x.fr')"))
    monde["pg"].execute(text("INSERT INTO kines (uid) VALUES ('kine-2')"))
    assert auth_as(uid="kine-2").get("/athletes/a1/bilans", headers=_AUTH).status_code == 403


# --------------------------------------------------------------------------- #
# L'INSTANTANÉ — la décision qui protège les données (§3.1)
# --------------------------------------------------------------------------- #

def test_MODIFIER_LE_MODÈLE_NE_TOUCHE_PAS_UN_BILAN_OUVERT(auth_as, monde):
    """⚠️ LA SPEC CENTRALE DU DOMAINE.

    La kiné fait passer le grip de 15 à 20 kg — geste parfaitement légitime, elle
    a changé de disque. SANS l'instantané, les résultats déjà enregistrés se
    mettraient à dire autre chose : aucune alerte, aucune trace, juste une courbe
    devenue fausse. Et le jour où quelqu'un s'en apercevrait, il n'y aurait plus
    aucun moyen de savoir sous quelle charge les anciennes valeurs ont été prises.

    C'est ce test qui autorise tout le reste : parce qu'il tient, la kiné peut
    éditer ses modèles librement."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    avant = _resultat(bilan, "Grip")
    assert avant["chargeKg"] == 15 and avant["bilateral"] is True

    monde["pg"].execute(text(
        "UPDATE bilan_tests SET charge_kg = 20, libelle = 'Grip pince', "
        "bilateral = false, mesure = 'reps' WHERE id = CAST(:t AS uuid)"),
        {"t": monde["tests"]["grip"]})

    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    apres = _resultat(relu, "Grip")
    assert apres["chargeKg"] == 15, "la charge du bilan a suivi le modèle"
    assert apres["bilateral"] is True, "la latéralité du bilan a suivi le modèle"
    assert apres["mesure"] == "secondes", "l'unité du bilan a suivi le modèle"


def test_L_IMAGE_DU_TEST_SUIT_DANS_LE_BILAN(auth_as, monde, monkeypatch):
    """⚠️ LE MANQUE QUI SE VOYAIT À L'ÉCRAN (FRE-99). Une photo rattachée au test
    du modèle ne descendait pas dans le bilan — donc elle n'existait nulle part
    là où quelqu'un exécute le mouvement. La kiné compose une fois, l'athlète et
    le praticien lisent à chaque passage : c'est le bilan qui est l'écran utile.

    ⚠️ ET L'URL EST SIGNÉE, jamais le chemin — le seau est privé."""
    from app.kine import mediatheque
    monkeypatch.setattr(mediatheque, "url_signee",
                        lambda chemin, duree=0: f"https://signee.test/{chemin}")
    media = monde["pg"].execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) "
        "VALUES ('demo/grip.png','kine-1') RETURNING id")).scalar()
    seconde = monde["pg"].execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) "
        "VALUES ('demo/grip-fin.png','kine-1') RETURNING id")).scalar()
    _rattacher(monde, "grip", [media, seconde])

    bilan = _creer(auth_as(uid="kine-1"), monde)
    grip = _resultat(bilan, "Grip")
    # ⚠️ LES DEUX, ET DANS L'ORDRE. Un mouvement se montre en plusieurs photos —
    # départ, arrivée — et l'ordre est ce qui les rend lisibles.
    assert [m["id"] for m in grip["medias"]] == [str(media), str(seconde)]
    assert grip["medias"][0]["url"] == "https://signee.test/demo/grip.png"

    # Les autres tests n'ont pas d'image, et le disent sans bruit : la très
    # grande majorité des tests vaut par son protocole écrit.
    assert _resultat(bilan, "Érecteur du rachis")["medias"] == []


def test_CHANGER_L_IMAGE_DU_MODÈLE_NE_TOUCHE_PAS_UN_BILAN_OUVERT(auth_as, monde,
                                                                 monkeypatch):
    """⚠️ L'IMAGE OBÉIT À L'INSTANTANÉ, COMME LE PROTOCOLE ÉCRIT. C'est le choix
    qui a été fait plutôt qu'une jointure vers le test : une image est une
    CONSIGNE, et un bilan passé qui montrerait l'illustration d'aujourd'hui à
    côté du texte d'hier laisserait les deux se contredire en silence.

    Ce test est le seul endroit où ce choix est gardé — sans lui, remplacer la
    copie par un `JOIN` sur `bilan_tests` passerait toutes les autres specs."""
    from app.kine import mediatheque
    monkeypatch.setattr(mediatheque, "url_signee",
                        lambda chemin, duree=0: f"https://signee.test/{chemin}")
    ancienne = monde["pg"].execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) "
        "VALUES ('demo/avant.png','kine-1') RETURNING id")).scalar()
    _rattacher(monde, "grip", [ancienne])

    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)

    # La kiné refait la photo — geste légitime, elle a changé de prise de vue.
    nouvelle = monde["pg"].execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) "
        "VALUES ('demo/apres.png','kine-1') RETURNING id")).scalar()
    _rattacher(monde, "grip", [nouvelle])

    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert [m["id"] for m in _resultat(relu, "Grip")["medias"]] == [str(ancienne)], \
        "l'image du bilan a suivi le modèle"


def test_sans_stockage_le_bilan_se_lit_QUAND_MÊME(auth_as, monde, monkeypatch):
    """⚠️ UNE VIGNETTE MANQUANTE NE DOIT PAS EMPORTER UN DOSSIER MÉDICAL. Le jour
    où la clé Scaleway expirera (FRE-104), lire un bilan doit continuer à
    marcher — sans les images. Laisser remonter l'erreur ferait tomber la
    réponse ENTIÈRE pour une illustration."""
    from app.kine import mediatheque

    def _indisponible(*_a, **_k):
        raise mediatheque.MediathequeIndisponible("pas de clé")

    monkeypatch.setattr(mediatheque, "url_signee", _indisponible)
    media = monde["pg"].execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) "
        "VALUES ('demo/grip.png','kine-1') RETURNING id")).scalar()
    _rattacher(monde, "grip", [media])

    bilan = _creer(auth_as(uid="kine-1"), monde)
    grip = _resultat(bilan, "Grip")
    # L'identité reste — c'est l'ADRESSE qui manque, pas le rattachement.
    assert [m["id"] for m in grip["medias"]] == [str(media)]
    assert grip["medias"][0]["url"] is None


def test_un_test_AJOUTÉ_au_modèle_n_entre_pas_dans_un_bilan_ouvert(auth_as, monde):
    """Le pendant : le bilan est une COPIE, pas une vue. Un test ajouté après coup
    ferait autrement passer un bilan complet à incomplet, sans que l'athlète ait
    rien fait — et le ferait échouer à se finaliser."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    assert bilan["testsTotal"] == 3

    monde["pg"].execute(text(
        "INSERT INTO bilan_tests (rubrique_id, libelle, ordre) "
        "VALUES (CAST(:r AS uuid), 'Nouveau test', 9)"), {"r": monde["rubrique"]})

    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert relu["testsTotal"] == 3, "un test ajouté après coup s'est invité"


def test_un_test_RETIRÉ_du_modèle_n_entre_pas_dans_les_NOUVEAUX_bilans(auth_as, monde):
    """Le retrait doux fait son travail dans l'autre sens : il agit sur les futurs
    bilans, jamais sur les anciens (§3.2)."""
    client = auth_as(uid="kine-1")
    ancien = _creer(client, monde, date="2026-01-10")
    assert ancien["testsTotal"] == 3

    monde["pg"].execute(text(
        "UPDATE bilan_tests SET retire = true WHERE id = CAST(:t AS uuid)"),
        {"t": monde["tests"]["mobilite"]})

    nouveau = _creer(client, monde, date="2026-08-21")
    assert nouveau["testsTotal"] == 2, "le test retiré est encore proposé"
    relu = client.get(f"/athletes/a1/bilans/{ancien['id']}", headers=_AUTH).json()
    assert relu["testsTotal"] == 3, "le retrait a amputé un bilan déjà passé"


def test_le_NOM_DU_MODÈLE_est_recopié_dans_le_bilan(auth_as, monde):
    """Le modèle peut être renommé ou supprimé ; le bilan doit rester
    intelligible seul — « Bilan complet du 12/09 », pas « bilan sans nom »."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    assert bilan["modeleNom"] == "Bilan test"
    monde["pg"].execute(text("UPDATE bilan_modeles SET nom = 'Renommé' "
                             "WHERE id = CAST(:m AS uuid)"), {"m": monde["modele"]})
    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert relu["modeleNom"] == "Bilan test"


# --------------------------------------------------------------------------- #
# Le cycle de vie
# --------------------------------------------------------------------------- #

def test_UNE_RÉPONSE_PEUPLÉE_porte_TOUS_ses_champs(auth_as, monde):
    """⚠️ `response_model` FILTRE : un champ non déclaré disparaît en SILENCE. Cette
    spec fige l'ensemble EXACT des clés plutôt que de le supposer — leçon de FRE-70."""
    client = auth_as(uid="kine-1")
    cree = _creer(client, monde)
    assert set(cree) == {"id", "date", "statut", "kineUid", "modeleNom",
                         "testsRenseignes", "testsTotal", "antecedents", "notes",
                         "resultats", "creeLe", "modifieLe"}
    assert cree["statut"] == "en_cours"
    assert cree["testsTotal"] == 3 and cree["testsRenseignes"] == 0
    assert cree["kineUid"] == "kine-1", "le kiné qui l'a conduit est enregistré"

    assert set(cree["resultats"][0]) == {
        "id", "testId", "testLibelle", "rubriqueLibelle", "protocole", "vues",
        "cible", "mesure", "bilateral", "ordre", "ressenti", "detail",
        "mesureGauche", "mesureDroite", "chargeKg", "materiel",
        # Les images de démonstration (FRE-99) — figées avec le reste de
        # l'instantané, et en LISTE : un mouvement se montre en plusieurs photos.
        "medias"}


def test_la_LISTE_ne_porte_PAS_les_antécédents(auth_as, monde):
    """⚠️ LE PÉRIMÈTRE MÉDICAL SE GARDE ÉTROIT JUSQUE DANS LES CHARGES UTILES. Une
    liste s'affiche en entier ; y mettre l'historique médical le ferait transiter à
    chaque ouverture d'écran pour n'être lu qu'en ouvrant un bilan."""
    client = auth_as(uid="kine-1")
    _creer(client, monde, antecedents="entorse 2024")
    ligne = client.get("/athletes/a1/bilans", headers=_AUTH).json()[0]
    assert "antecedents" not in ligne


def test_un_bilan_rempli_par_l_ATHLÈTE_n_a_pas_de_kineUid(auth_as, monde):
    """Le champ dit qui a CONDUIT le bilan, pas qui suit l'athlète."""
    assert _creer(auth_as(uid="uid-1"), monde)["kineUid"] is None


def test_les_ANTÉCÉDENTS_se_pre_remplissent_depuis_le_précédent(auth_as, monde):
    """⚠️ §3.7 — ET C'EST LA RAISON POUR LAQUELLE L'HISTORIQUE MÉDICAL NE VIT PAS
    SUR `athletes`. Chaque bilan garde l'instantané de ce qui était connu À SA
    DATE, plus honnête qu'un champ unique écrasé : on peut relire ce qu'on savait
    alors. Le report évite de tout ressaisir ; l'athlète corrige."""
    client = auth_as(uid="kine-1")
    premier = _creer(client, monde, date="2026-01-10", antecedents="entorse cheville 2024")
    second = _creer(client, monde, date="2026-08-21")

    assert second["antecedents"] == "entorse cheville 2024"
    assert client.get(f"/athletes/a1/bilans/{premier['id']}", headers=_AUTH).json()[
        "antecedents"] == "entorse cheville 2024"


def test_des_antécédents_FOURNIS_l_emportent_sur_le_report(auth_as, monde):
    client = auth_as(uid="kine-1")
    _creer(client, monde, date="2026-01-10", antecedents="ancien")
    second = _creer(client, monde, date="2026-08-21", antecedents="corrigé par l'athlète")
    assert second["antecedents"] == "corrigé par l'athlète"


def test_un_modèle_VIDE_est_refusé(auth_as, monde):
    """⚠️ UN BILAN SANS TEST SE FINALISERAIT AUSSITÔT (0 sur 0) et entrerait dans
    les comparaisons en n'y apportant rien — un point sur une courbe qui ne mesure
    rien. Et la transaction est annulée : aucun bilan fantôme ne subsiste."""
    vide = monde["pg"].execute(text(
        "INSERT INTO bilan_modeles (nom) VALUES ('Vide') RETURNING id")).scalar()
    client = auth_as(uid="kine-1")
    r = client.post("/athletes/a1/bilans", headers=_AUTH,
                    json={"date": "2026-08-21", "modeleId": str(vide)})
    assert r.status_code == 409 and r.json()["code"] == "modele_vide"
    assert client.get("/athletes/a1/bilans", headers=_AUTH).json() == []


def test_un_modèle_INCONNU_rend_404(auth_as, monde):
    r = auth_as(uid="kine-1").post("/athletes/a1/bilans", headers=_AUTH, json={
        "date": "2026-08-21", "modeleId": "11111111-2222-3333-4444-555555555555"})
    assert r.status_code == 404 and r.json()["code"] == "modele_introuvable"


def test_les_modèles_ARCHIVÉS_ne_sont_pas_proposés(auth_as, monde):
    client = auth_as(uid="kine-1")
    assert len(client.get("/athletes/a1/bilans/modeles", headers=_AUTH).json()["modeles"]) == 1
    monde["pg"].execute(text("UPDATE bilan_modeles SET archive = true "
                             "WHERE id = CAST(:m AS uuid)"), {"m": monde["modele"]})
    assert client.get("/athletes/a1/bilans/modeles", headers=_AUTH).json()["modeles"] == []


# --------------------------------------------------------------------------- #
# La saisie d'un résultat
# --------------------------------------------------------------------------- #

def test_la_saisie_est_IDEMPOTENTE(auth_as, monde):
    """⚠️ APPELÉE À CHAQUE FRAPPE. La ligne existe depuis la création du bilan :
    on la met à jour, on ne l'accumule pas."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    for valeur in (30, 42, 45):
        r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}",
                         headers=_AUTH, json={"mesureGauche": valeur})
        assert r.status_code == 200
        assert r.json()["testsRenseignes"] == 1, "un seul résultat, réécrit"
    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert _resultat(relu, "Grip")["mesureGauche"] == 45


def test_NULL_et_ZÉRO_traversent_l_API_sans_se_confondre(auth_as, monde):
    """⚠️ LA DISTINCTION EST CLINIQUE, et elle doit survivre à la sérialisation.

      None = test NON RÉALISÉ (matériel absent, douleur qui l'empêche) ;
      0    = test réalisé, échec complet.

    Un `or 0` quelque part dans la chaîne les replierait l'un sur l'autre, et un
    test sauté creuserait la courbe exactement comme une régression."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                 json={"mesureGauche": 0, "mesureDroite": None})
    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    res = _resultat(relu, "Grip")
    assert res["mesureGauche"] == 0, "un échec complet reste un ZÉRO"
    assert res["mesureDroite"] is None, "un test non réalisé reste ABSENT"


def test_un_RÉSULTAT_INCONNU_est_introuvable(auth_as, monde):
    """La ligne appartient au bilan : un identifiant venu d'ailleurs n'ouvre rien."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    r = client.patch(
        f"/athletes/a1/bilans/{bilan['id']}/resultats/11111111-2222-3333-4444-555555555555",
        headers=_AUTH, json={"mesureGauche": 30})
    assert r.status_code == 404 and r.json()["code"] == "resultat_introuvable"


def test_un_test_de_TRONC_refuse_une_mesure_DROITE(auth_as, monde):
    """⚠️ §3.5 — LE DÉFAUT VENU DU FORMULAIRE, refermé côté écriture. Il posait la
    question « Droite/Gauche » sur des tests de TRONC ; l'accepter ici remplirait
    `mesure_droite` au hasard pour des années, et personne ne le verrait avant
    d'essayer de comparer.

    ⚠️ ET C'EST L'INSTANTANÉ QUI EN DÉCIDE, pas le modèle courant : si la kiné rend
    ce test bilatéral demain, les bilans ouverts aujourd'hui continuent de n'en
    accepter qu'une valeur — cohérent avec ce qui a été demandé à l'athlète."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Érecteur du rachis")["id"]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                     json={"mesureGauche": 45, "mesureDroite": 40})
    assert r.status_code == 422 and r.json()["code"] == "test_non_bilateral"


def test_un_test_de_tronc_accepte_UNE_mesure(auth_as, monde):
    """Le pendant du précédent : la garde refuse le côté en trop, pas le test."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Érecteur du rachis")["id"]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                     json={"mesureGauche": 45})
    assert r.status_code == 200


def test_un_test_SANS_MESURE_refuse_un_nombre(auth_as, monde):
    """⚠️ UNE VALEUR QU'AUCUN ÉCRAN N'AFFICHE EST UNE VALEUR JAMAIS CORRIGÉE. Les
    tests de mobilité ne portent qu'un ressenti : y accepter un nombre le
    laisserait dormir en base, invisible et faux."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Épaule — flexion")["id"]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                     json={"mesureGauche": 12})
    assert r.status_code == 422 and r.json()["code"] == "test_sans_mesure"


def test_la_CHARGE_réellement_utilisée_s_enregistre(auth_as, monde):
    """⚠️ PARCE QUE LA RÉALITÉ DÉVIE. Le protocole du grip dit 15 kg ; la salle n'a
    qu'un disque de 12. Enregistrer sous « 15 kg » serait un mensonge silencieux,
    et la comparaison le propagerait."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                 json={"mesureGauche": 40, "chargeKg": 12})
    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert _resultat(relu, "Grip")["chargeKg"] == 12


def test_un_test_VIDÉ_ne_compte_plus_comme_renseigné(auth_as, monde):
    """⚠️ « RENSEIGNÉ » N'EST PAS « A UNE LIGNE ». Toutes les lignes existent dès la
    création (la copie du modèle) : compter les lignes donnerait 3 sur 3 sur un
    bilan vierge. Et « 12 sur 32 » est le chiffre sur lequel on décide de reprendre
    ou de finaliser — un compteur faux vaut moins qu'aucun compteur."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]

    pose = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}",
                        headers=_AUTH, json={"ressenti": "ras"})
    assert pose.json()["testsRenseignes"] == 1

    vide = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}",
                        headers=_AUTH, json={"ressenti": None})
    assert vide.json()["testsRenseignes"] == 0, "un test vidé compte encore"


def test_la_CHARGE_SEULE_ne_compte_PAS_comme_renseigné(auth_as, monde):
    """⚠️ ELLE EST PRÉ-REMPLIE PAR LA COPIE DU MODÈLE. La compter ferait démarrer
    tout bilan à « 2 sur 3 » sans que personne n'ait rien fait — le compteur
    dirait le contenu du modèle, pas le travail de l'athlète."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}",
                     headers=_AUTH, json={"chargeKg": 12})
    assert r.json()["testsRenseignes"] == 0


def test_n_IMPORTE_QUEL_champ_de_saisie_suffit_à_compter(auth_as, monde):
    """Ce n'est pas le ressenti qui décide, c'est la présence de QUELQUE CHOSE
    qu'un humain a saisi. Un test dont on n'a noté qu'un commentaire est un test
    sur lequel on est passé."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    for i, corps in enumerate([
        {"detail": "genou qui claque"},
        {"mesureGauche": 0},          # ⚠️ ZÉRO COMPTE : c'est un échec constaté.
        {"ressenti": "gene"},
    ], start=1):
        r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}",
                         headers=_AUTH, json=corps)
        assert r.json()["testsRenseignes"] == 1, f"cas {i} : {corps}"


# --------------------------------------------------------------------------- #
# La finalisation — ce qui fige
# --------------------------------------------------------------------------- #

def _finaliser(client, bilan):
    for res in bilan["resultats"]:
        r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{res['id']}",
                         headers=_AUTH, json={"ressenti": "ras"})
        assert r.status_code == 200, r.text[:200]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH,
                     json={"statut": "finalise"})
    assert r.status_code == 200 and r.json()["statut"] == "finalise", r.text[:200]


def test_un_bilan_INCOMPLET_ne_se_finalise_pas(auth_as, monde):
    """⚠️ UN BILAN PARTIEL FIGÉ EN RÉFÉRENCE FERAIT COMPARER DES TESTS À RIEN :
    l'évolution ne se lirait que sur ce qui a été fait deux fois, et un test
    manquant se confondrait avec un test qui n'existait pas encore.

    Le message DIT COMBIEN IL RESTE : un refus qui n'indique pas la sortie oblige
    à recompter soi-même."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    rid = _resultat(bilan, "Grip")["id"]
    client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                 json={"ressenti": "ras"})

    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH,
                     json={"statut": "finalise"})
    assert r.status_code == 409 and r.json()["code"] == "bilan_incomplet"
    assert "2 tests" in r.json()["detail"], r.json()["detail"]


def test_un_test_qu_on_NE_PEUT_PAS_faire_compte_quand_même(auth_as, monde):
    """⚠️ CE QUI REND LA RÈGLE TENABLE. « Renseigné » n'est pas « mesuré » : un test
    impossible — GHD absent, douleur qui l'empêche — se marque d'un commentaire et
    compte, ses mesures restant à NULL.

    C'est même PLUS honnête que de le laisser vide : la base distingue « non
    réalisé » de « échec complet », mais seulement si quelqu'un a dit lequel des
    deux c'était. Sans cette porte, la règle pousserait à inventer des chiffres."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    for res in bilan["resultats"]:
        corps = ({"detail": "pas de GHD à la salle"} if res["testLibelle"] == "Grip"
                 else {"ressenti": "ras"})
        client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{res['id']}",
                     headers=_AUTH, json=corps)

    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH,
                     json={"statut": "finalise"})
    assert r.status_code == 200, r.text[:200]

    relu = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    sans_ghd = _resultat(relu, "Grip")
    assert sans_ghd["mesureGauche"] is None and sans_ghd["detail"] == "pas de GHD à la salle"


def test_un_bilan_FINALISÉ_n_accepte_plus_de_résultat(auth_as, monde):
    """Il devient la référence comparable : le modifier ferait bouger, après coup,
    un point sur lequel une évolution a déjà été lue."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    _finaliser(client, bilan)
    rid = _resultat(bilan, "Grip")["id"]
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}/resultats/{rid}", headers=_AUTH,
                     json={"mesureGauche": 99})
    assert r.status_code == 409 and r.json()["code"] == "bilan_deja_finalise"


def test_un_bilan_FINALISÉ_ne_se_ROUVRE_pas(auth_as, monde):
    """Une correction se fait par un NOUVEAU bilan — ce que ferait un praticien sur
    un dossier papier."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    _finaliser(client, bilan)
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH,
                     json={"statut": "en_cours"})
    assert r.status_code == 409 and r.json()["code"] == "bilan_deja_finalise"


@pytest.mark.parametrize("uid", ["kine-1", "uid-1"])
@pytest.mark.parametrize("corps", [
    {"antecedents": "réécrits après coup"},
    {"notes": "réécrites après coup"},
    {"date": "2026-01-01"},
    # Refinaliser un bilan finalisé n'est pas un geste non plus.
    {"statut": "finalise"},
])
def test_un_bilan_FINALISÉ_ne_se_MODIFIE_plus(auth_as, monde, uid, corps):
    """⚠️ TROIS GARDES SUR QUATRE EXISTAIENT, ET C'EST CE QUI RENDAIT LE TROU
    INVISIBLE (FRE-132). Les résultats, la réouverture et la suppression étaient
    fermés ; la MÉTA — date, antécédents, notes — se réécrivait sans condition,
    par le kiné comme par l'athlète. Or c'est la date qui situe le point sur la
    courbe, et les antécédents sont la donnée la plus sensible du produit. Seul
    l'écran figeait (`views/bilan.tsx`), c'est-à-dire personne.

    Une correction se fait par un NOUVEAU bilan — la docstring de la route le
    disait déjà, sans le rendre vrai."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    _finaliser(client, bilan)
    avant = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()

    r = auth_as(uid=uid).patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH, json=corps)
    assert r.status_code == 409 and r.json()["code"] == "bilan_deja_finalise", r.text[:200]
    # ⚠️ ET RIEN N'A BOUGÉ — un refus qui aurait écrit avant de refuser serait pire.
    apres = client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()
    assert apres == avant


def test_un_corps_VIDE_sur_un_bilan_finalisé_passe(auth_as, monde):
    """Le seul PATCH qui n'écrit rien : il ne peut rien casser, et il rend la
    fiche telle qu'elle est."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    _finaliser(client, bilan)
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH, json={})
    assert r.status_code == 200 and r.json()["statut"] == "finalise"


def test_un_bilan_FINALISÉ_ne_se_SUPPRIME_pas(auth_as, monde):
    """⚠️ UN BILAN FINALISÉ EST UNE MESURE DATÉE. L'effacer retire un point d'une
    courbe de santé — même prudence que le refus de nettoyer les charges réelles
    douteuses (FRE-75) : on ne remplace pas une donnée gênante par son absence."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    _finaliser(client, bilan)
    r = client.delete(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH)
    assert r.status_code == 409 and r.json()["code"] == "bilan_deja_finalise"


def test_un_bilan_EN_COURS_se_supprime(auth_as, monde):
    """Le pendant : une saisie abandonnée n'a pas à encombrer la liste."""
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    assert client.delete(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).status_code == 200
    assert client.get("/athletes/a1/bilans", headers=_AUTH).json() == []


def test_les_notes_et_la_date_se_corrigent(auth_as, monde):
    client = auth_as(uid="kine-1")
    bilan = _creer(client, monde)
    r = client.patch(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH,
                     json={"notes": "reprise progressive", "date": "2026-08-20"})
    assert r.status_code == 200 and r.json()["date"] == "2026-08-20"
    assert client.get(f"/athletes/a1/bilans/{bilan['id']}", headers=_AUTH).json()[
        "notes"] == "reprise progressive"


def test_un_bilan_d_un_AUTRE_athlète_est_introuvable(auth_as, monde):
    """⚠️ LE BILAN EST CHERCHÉ SOUS SON ATHLÈTE, pas globalement. Sans la clause
    `athlete_id` dans la requête, connaître un uuid suffirait à lire le dossier
    médical de n'importe qui — l'autorisation porte sur le chemin, pas sur l'objet."""
    autre = "bbbbbbbb-2222-2222-2222-222222222222"
    monde["pg"].execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name) "
        "VALUES (CAST(:a AS uuid),'a2','coach-1','kine-1','B')"), {"a": autre})
    client = auth_as(uid="kine-1")
    b = client.post("/athletes/a2/bilans", headers=_AUTH,
                    json={"date": "2026-08-21", "modeleId": monde["modele"]}).json()["id"]
    r = client.get(f"/athletes/a1/bilans/{b}", headers=_AUTH)
    assert r.status_code == 404 and r.json()["code"] == "bilan_introuvable"


def test_un_athlète_inconnu_rend_404(auth_as, monde):
    assert auth_as(uid="kine-1").get("/athletes/zzz/bilans", headers=_AUTH).status_code == 404
