# ⚠️ LE BUCKET `athlete-avatars` A ÉTÉ SUPPRIMÉ (2026-08-27, FRE-88).
#
# Il portait les photos de profil d'athlètes, retirées du produit le 20/08 avec
# la coupure Firestore : les règles Storage lisaient `athletes/{id}` pour
# autoriser, et retirer les photos a supprimé toute la chaîne. Le bucket, lui,
# était resté — avec son CORS ouvert à douze origines et son enregistrement
# Firebase Storage, pour un service que plus rien n'appelle.
#
# Vérifié avant de supprimer plutôt que supposé : il ne contenait **rien** — un
# seul objet de 0 octet, marqueur de dossier daté du 10/06. Aucune photo réelle
# ne subsistait.
#
# ⚠️ ET LA LEÇON EST DANS LA MANIÈRE, PAS DANS LA SUPPRESSION. Le bucket a
# d'abord été effacé À LA MAIN (`gcloud storage rm`) alors qu'il était déclaré
# ici. Terraform l'a vu disparaître et a voulu le RECRÉER au plan suivant, CORS
# et tout — c'est-à-dire ressusciter précisément ce qu'on venait de retirer.
# Supprimer une ressource gérée par du code se fait dans le CODE ; sinon le code
# la remet. C'est le même défaut que celui que FRE-82 reprochait aux `GRANT`
# posés à la main, dans l'autre sens.
#
# S'il faut un jour re-héberger des médias d'athlètes, ne pas ressortir ce
# fichier de l'historique : le produit stocke désormais ses images chez Scaleway
# (`scaleway.tf`, seau PRIVÉ servi par brokkr), et ouvrir un second stockage est
# exactement ce que FRE-100 cherche à éviter.
