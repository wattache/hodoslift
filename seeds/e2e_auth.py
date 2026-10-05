"""Les comptes de test dans l'émulateur d'authentification.

DEUX comptes d'abord, parce que le harnais éprouve deux RÔLES : le coach qui
programme, et l'athlète qui saisit son réalisé — et à qui la méta doit rester
fermée (403). Un seul compte ne peut pas prouver un refus d'autorisation. Puis
le kiné, le compte dont l'identité a changé, et le coach-athlète (voir `COMPTES`).

Deux exigences par compte, toutes les deux structurantes :

  * un **uid FIXE** — il doit correspondre à ce que sème `seed_e2e.sql`
    (`e2e-coach` comme coach du programme, `e2e-athlete-user` comme
    `athletes.user_uid`), sinon l'authentification passe et l'autorisation
    refuse ;
  * un **provider `google.com`** — l'app appelle `signInWithPopup(google)`, et
    l'écran de l'émulateur ne propose que les comptes de ce fournisseur. Un
    compte créé par mot de passe n'y apparaîtrait pas, et la popup en créerait
    un nouveau, à l'uid aléatoire.

D'où `import_users` plutôt que `create_user` : c'est le seul chemin qui pose les
deux à la fois. Idempotent (les comptes sont recréés à chaque appel).

Usage :
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=french-forge-600 \\
        uv run python -m scripts.seed_e2e_auth
"""

import os
import sys

import firebase_admin
from firebase_admin import auth as fa

COMPTES = [
    ("e2e-coach", "e2e@french-forge.test", "Coach E2E"),
    ("e2e-athlete-user", "athlete-e2e@french-forge.test", "Athlète E2E"),
    # Le TROISIÈME rôle du harnais (FRE-65) : il entre, il voit, il n'écrit pas.
    ("e2e-kine", "kine-e2e@french-forge.test", "Kiné E2E"),
    # ⚠️ LE COMPTE DONT L'IDENTITÉ A CHANGÉ (FRE-76). Il porte l'adresse d'une
    # fiche athlète DÉJÀ rattachée à un autre uid — le cas du compte Google
    # recréé. Sans lui, `POST /athletes/link` n'a aucun refus à nommer, et le
    # parcours « impasse → détachement → reprise » ne peut pas être joué.
    ("e2e-identite", "identite-e2e@french-forge.test", "Identité E2E"),
    # ⚠️ LE COACH QUI EST AUSSI ATHLÈTE (FRE-142) : coach de son propre programme,
    # comme William. Le seul compte pour lequel le serveur résout DEUX rôles sur
    # un même programme — et le harnais n'en avait aucun.
    ("e2e-coach-athlete", "coach-athlete-e2e@french-forge.test", "Coach-athlète E2E"),
]


def main() -> int:
    if not os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        print("⛔ FIREBASE_AUTH_EMULATOR_HOST n'est pas posée — refus.\n"
              "   Sans elle, ce script écrirait dans la VRAIE base d'authentification.")
        return 1

    firebase_admin.initialize_app(options={
        "projectId": os.environ.get("GOOGLE_CLOUD_PROJECT", "french-forge-600")})
    for uid, _, _ in COMPTES:
        try:
            fa.delete_user(uid)
        except Exception:
            pass

    res = fa.import_users([
        fa.ImportUserRecord(
            uid=uid, email=email, display_name=nom,
            # ⚠️ `email_verified` FAIT PARTIE DU DISPOSITIF, pas du décor.
            # `POST /athletes/link` refuse un email non prouvé — il sert de clé
            # de rapprochement. Sans ce drapeau, l'émulateur mint des jetons à
            # `email_verified: false` et TOUTE la route de rattachement répond
            # 403 : elle était donc inatteignable par le harnais, ce qui est
            # exactement pourquoi aucune spec réelle ne la couvrait. Un vrai
            # compte Google, lui, est vérifié.
            email_verified=True,
            provider_data=[fa.UserProvider(uid=f"{uid}-google", provider_id="google.com",
                                           email=email, display_name=nom)],
        )
        for uid, email, nom in COMPTES
    ])
    if res.failure_count:
        print(f"❌ {res.errors[0].reason}")
        return 1
    for uid, email, _ in COMPTES:
        print(f"✅ compte {uid} ({email}) prêt, provider google.com")
    return 0


if __name__ == "__main__":
    sys.exit(main())
