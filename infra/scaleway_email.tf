# ============================================================================
# SCALEWAY TRANSACTIONAL EMAIL — le socle d'envoi (FRE-166, 10/09/2026)
#
# ⚠️ IL N'Y A AUCUN ENVOI D'EMAIL DANS LE PROJET, et ce fichier n'en crée pas
# non plus. Il pose l'INFRASTRUCTURE : un domaine expéditeur authentifié, et le
# droit, pour brokkr, de poster par SMTP. Le code qui enverra vient après, et
# c'est FRE-131 qui le réclame en premier (confirmer une adresse avant qu'elle
# ne serve de clé de rattachement).
#
# POURQUOI SCALEWAY, ET PAS AUTRE CHOSE. GCP ne propose rien de transactionnel,
# et le port 25 sortant est fermé sur Cloud Run — la recommandation de Google
# est de passer par un tiers. Le relais SMTP Workspace en est un, mais c'est un
# relais de messagerie d'entreprise (quotas, pas de journal de livraison), et il
# ancrerait du neuf sur GCP contre l'intention du 22/08. Resend a dix fois plus
# de marge gratuite (3 000/mois contre 300) — sans objet : le besoin réel est de
# quelques dizaines d'envois par mois, les deux restent gratuits. Ce qui
# départage, c'est qu'un fournisseur est DÉJÀ branché ici, avec son identité et
# sa clé (`scaleway.tf`), et qu'il est européen sur une app qui porte des données
# de santé.
#
# ⚠️ LA ZONE DNS N'EST PAS CHEZ SCALEWAY — elle est chez Cloudflare (vérifié le
# 10/09 : `karina`/`morgan.ns.cloudflare.com`). Trois conséquences, et elles
# structurent tout le fichier :
#
#   1. `autoconfig` est INUTILISABLE. L'option ne sait écrire que dans une zone
#      Scaleway ; ici elle ne trouverait rien à configurer.
#   2. Pas de `scaleway_domain_record` non plus, pour la même raison.
#   3. Les quatre enregistrements se posent À LA MAIN dans Cloudflare — une
#      fois. Terraform les DICTE (sortie `scaleway_tem_dns_a_poser`) puis les
#      VÉRIFIE (`scaleway_tem_domain_validation`). Ce n'est donc pas un pas
#      manuel non gardé : l'apply refuse d'aboutir tant que la zone ne répond
#      pas ce que Scaleway attend.
#
# ⚠️ ET ON N'A PAS AJOUTÉ LE PROVIDER CLOUDFLARE, délibérément. Il rendrait ces
# quatre lignes déclaratives, au prix d'un provider de plus et surtout d'un
# jeton d'API de plus — qu'il faudrait exporter dans l'environnement à chaque
# shell, alors que la propriété la plus utile du montage Scaleway est justement
# qu'il n'y a RIEN à ré-exporter (`~/.config/scw/config.yaml`). Quatre
# enregistrements posés une fois et vérifiés par un apply ne valent pas ça. À
# reconsidérer le jour où la zone Cloudflare portera d'autres choses mouvantes.
# ============================================================================

# ----------------------------------------------------------------------------
# 1. LE DOMAINE EXPÉDITEUR
#
# ⚠️ UN ABONNEMENT À L'OFFRE EST UN PRÉALABLE, ET IL N'EST PAS TERRAFORMABLE.
# Constaté à l'apply du 10/09, pas anticipé :
#
#     403 Forbidden: No active offer subscription for the project
#
# Le projet doit être abonné AVANT qu'un domaine puisse exister. Et il n'y a pas
# de ressource pour ça — vérifié dans le provider 2.81.0 ET dans 2.82.0 :
# `scaleway_tem_offer_subscription` n'existe qu'en SOURCE DE DONNÉES. Monter de
# version n'y changerait donc rien, ce qui règle la question avant qu'elle ne se
# pose.
#
#     scw tem offers update name=essential region=fr-par
#
# ⚠️ `essential` EST LE PALIER GRATUIT, sans engagement : 300 messages par mois,
# 5 domaines, `commitment_period = 0` (relevé le 10/09 par `scw tem offers
# list`). L'autre palier, `scale`, est un engagement mensuel — il n'a rien à
# faire ici tant que le besoin se compte en dizaines d'envois.
#
# C'est un BOOTSTRAP, au même titre que le bucket de state et la clé Scaleway :
# une chose faite une fois, hors cycle Terraform, parce qu'elle conditionne le
# cycle lui-même.
#
# ⚠️ L'APEX, PAS UN SOUS-DOMAINE, et c'est un choix. `mail.french-forge.com`
# isolerait la réputation d'envoi — sauf que rien d'autre n'envoie depuis ce
# domaine : il n'y a AUCUN MX sur `french-forge.com` (vérifié le 10/09), donc
# aucune messagerie à protéger, et donc rien à isoler. Reste l'argument qui
# compte pour un athlète devant sa boîte : `french-forge.com` se reconnaît,
# `mail.french-forge.com` fait douter. Basculer, si le besoin apparaît, c'est
# changer `var.scaleway_tem_domaine` et reposer les enregistrements.
#
# ⚠️ `accept_tos` FORCE LA RECRÉATION s'il change. Il est à `true` une fois pour
# toutes ; le repasser à `false` détruirait le domaine et son authentification.
# ----------------------------------------------------------------------------

resource "scaleway_tem_domain" "expediteur" {
  name       = var.scaleway_tem_domaine
  region     = var.scaleway_region
  project_id = data.scaleway_account_project.courant.id

  # Conditions d'utilisation du service transactionnel — obligatoire, et
  # l'API refuse la création sans.
  accept_tos = true

  # Cf. l'en-tête : la zone est chez Cloudflare, il n'y a rien à
  # autoconfigurer. Explicite plutôt qu'omis, parce que c'est une CONSÉQUENCE
  # d'un fait d'infrastructure, pas un défaut qu'on aurait laissé traîner.
  autoconfig = false
}

# ----------------------------------------------------------------------------
# 2. LA VÉRIFICATION — le garde-fou du pas manuel
#
# ⚠️ CETTE RESSOURCE EST LE SEUL VÉRIFICATEUR DU FICHIER, et elle LÈVE : elle
# interroge Scaleway jusqu'à ce que le domaine passe `checked`, et échoue au
# bout du délai si la zone ne répond pas. Un domaine TEM non vérifié n'envoie
# rien du tout — sans elle, l'apply sortirait vert sur une infrastructure
# incapable de poster un seul message.
#
# ⚠️ D'OÙ LES DEUX TEMPS, ET LE DRAPEAU QUI LES SÉPARE. Au premier apply les
# enregistrements n'existent pas encore : la vérification ne peut qu'échouer.
# `scaleway_tem_dns_pose` reste donc à `false` le temps de lire la sortie et de
# poser les quatre lignes dans Cloudflare, puis passe à `true`.
#
#   1. `terraform apply`                        → le domaine existe, la sortie
#                                                 `scaleway_tem_dns_a_poser`
#                                                 dicte les enregistrements
#   2. poser les 4 lignes dans Cloudflare
#   3. `scaleway_tem_dns_pose = true`, `apply`  → Terraform VÉRIFIE
#
# Le drapeau n'est pas qu'un interrupteur : il écrit dans le dépôt où en est le
# monde. Le lire suffit à savoir si la zone est posée.
# ----------------------------------------------------------------------------

resource "scaleway_tem_domain_validation" "expediteur" {
  count = var.scaleway_tem_dns_pose ? 1 : 0

  domain_id = scaleway_tem_domain.expediteur.id
  region    = var.scaleway_region

  # La propagation DNS n'est pas instantanée, et Cloudflare est rapide sans être
  # magique. Dix minutes laissent la place à un TTL, sans faire d'un apply raté
  # une demi-heure d'attente.
  timeout = 600
}

# ----------------------------------------------------------------------------
# 3. LE DROIT D'ENVOYER
#
# ⚠️ LA MÊME APPLICATION IAM, ET LA MÊME CLÉ QUE LES MÉDIAS. Une seconde
# application `brokkr-email` aurait sa propre clé, donc sa propre expiration —
# et l'expiration est ici une panne à retardement, pas une formalité
# (cf. `var.scaleway_cle_expire_le`). Deux échéances, c'est deux fois plus de
# chances d'en manquer une. C'est le même service qui envoie et qui téléverse.
#
# ⚠️ MAIS UNE SECONDE POLITIQUE, PAS UNE POLITIQUE ÉLARGIE. `brokkr-medias` dit
# ce que brokkr fait des objets ; celle-ci dit ce qu'il fait du courrier. Les
# fondre rendrait illisible ce qu'on retire le jour où l'un des deux usages
# disparaît.
#
# ⚠️ ET LE JEU DE PERMISSIONS EST LE PLUS ÉTROIT QUI EXISTE — confirmé le 10/09
# par `scw iam permission-set list`, pas deviné. Scaleway en expose dix-sept
# pour le transactionnel ; `TransactionalEmailEmailSmtpCreate` est le seul qui
# donne l'envoi PAR SMTP et rien d'autre : ni l'API d'envoi, ni la configuration
# des domaines, ni la lecture des messages déjà partis. Une clé qui fuite ne
# peut alors que poster — pas révoquer le domaine, pas relire ce qui a été
# envoyé à un athlète.
# ----------------------------------------------------------------------------

resource "scaleway_iam_policy" "brokkr_email" {
  # Même contrainte de nommage que `brokkr-medias` : Scaleway refuse accents et
  # tirets cadratins dans un nom de politique. La phrase lisible va dans la
  # description.
  name           = "brokkr-email"
  description    = "Envoi SMTP transactionnel, sur le seul projet French Forge"
  application_id = scaleway_iam_application.brokkr.id

  rule {
    project_ids          = [data.scaleway_account_project.courant.id]
    permission_set_names = var.scaleway_tem_permission_sets
  }
}

# ----------------------------------------------------------------------------
# Sorties
#
# ⚠️ AUCUNE VALEUR N'EST ÉCRITE À LA MAIN ICI. Les quatre enregistrements
# viennent tels quels de Scaleway : recopier un exemple de documentation est le
# meilleur moyen d'authentifier un domaine avec la clé DKIM de quelqu'un
# d'autre. `terraform output scaleway_tem_dns_a_poser` dit ce qu'il y a à
# poser, et rien d'autre.
#
# ⚠️ CLOUDFLARE ATTEND DES NOMS RELATIFS et ajoute la zone lui-même. Les noms
# rendus par Scaleway sont pleinement qualifiés : coller `_dmarc.french-forge.com`
# dans Cloudflare crée `_dmarc.french-forge.com.french-forge.com`. C'est le
# piège classique de cette manipulation, et il est silencieux — la vérification
# échoue sans dire pourquoi.
# ----------------------------------------------------------------------------

output "scaleway_tem_dns_a_poser" {
  description = "Les enregistrements à créer dans Cloudflare pour authentifier le domaine expéditeur. Noms PLEINEMENT QUALIFIÉS : Cloudflare veut le nom relatif."
  value = {
    # ⚠️ `spf_value`, ET SURTOUT PAS `spf_config`. Les deux existent, et le
    # second est un FRAGMENT — `include:_spf.tem.scaleway.com` — destiné à être
    # inséré dans un SPF qui existe déjà. Le coller tel quel crée un
    # enregistrement qui ne commence pas par `v=spf1` : aucun destinataire ne le
    # lit comme du SPF, et rien ne le signale. `spf_value` est
    # l'enregistrement COMPLET.
    #
    # ⚠️ ET IL NE PEUT Y EN AVOIR QU'UN. Deux enregistrements `v=spf1` sur un
    # domaine invalident les deux. `french-forge.com` n'en a aucun aujourd'hui
    # (vérifié le 10/09 : seul un `hosting-site=` traîne à l'apex, qui ne gêne
    # pas) — mais c'est à revérifier avant de poser, pas après.
    spf = {
      type   = "TXT"
      nom    = scaleway_tem_domain.expediteur.name
      valeur = scaleway_tem_domain.expediteur.spf_value
    }
    dkim = {
      type   = "TXT"
      nom    = scaleway_tem_domain.expediteur.dkim_name
      valeur = scaleway_tem_domain.expediteur.dkim_config
    }
    # ⚠️ LA POLITIQUE DMARC RENDUE PAR SCALEWAY EST UNE POLITIQUE
    # D'OBSERVATION (`p=none`) : elle fait remonter les abus sans rien rejeter.
    # C'est le bon point de départ — durcir avant d'avoir vu un mois de
    # rapports, c'est se couper soi-même. Le resserrage est un geste séparé,
    # dans Cloudflare, une fois la délivrabilité constatée.
    dmarc = {
      type   = "TXT"
      nom    = scaleway_tem_domain.expediteur.dmarc_name
      valeur = scaleway_tem_domain.expediteur.dmarc_config
    }
    # ⚠️ UN MX QUI JETTE, ET C'EST VOULU. `french-forge.com` n'a aucun MX : un
    # domaine qui envoie sans savoir recevoir est mal noté, et ses retours se
    # perdent en erreurs illisibles. Celui-ci déclare une destination qui
    # absorbe. À REMPLACER le jour où une vraie messagerie s'installe sur ce
    # domaine — c'est le seul enregistrement des quatre qui bloquerait un
    # usage futur.
    #
    # ⚠️ `mx_config`, PAS `mx_blackhole` — et ce n'est pas le même hôte. Le
    # second rend `blackhole.scw-tem.cloud.`, le premier
    # `10 blackhole.tem.scaleway.com.` : priorité comprise, et un nom
    # DIFFÉRENT. C'est `mx_config` que Scaleway vérifie. Cloudflare demande la
    # priorité dans son propre champ, donc les deux morceaux sont séparés ici
    # plutôt que laissés collés dans une chaîne à découper à la main.
    mx = {
      type     = "MX"
      nom      = scaleway_tem_domain.expediteur.name
      priorite = split(" ", scaleway_tem_domain.expediteur.mx_config)[0]
      valeur   = split(" ", scaleway_tem_domain.expediteur.mx_config)[1]
    }
  }
}

output "scaleway_tem_smtp" {
  description = "Coordonnées SMTP du domaine expéditeur. Le mot de passe est la secret key de brokkr (`scaleway_brokkr_secret_key`), déjà dans Secret Manager."
  value = {
    host        = scaleway_tem_domain.expediteur.smtp_host
    port        = scaleway_tem_domain.expediteur.smtps_port
    utilisateur = scaleway_tem_domain.expediteur.smtps_auth_user
    statut      = scaleway_tem_domain.expediteur.status
  }
}
