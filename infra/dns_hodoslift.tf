# ============================================================================
# LA ZONE DNS DE hodoslift.com — le courrier d'abord (Proton)
#
# Le domaine est enregistré chez Scaleway, sa zone aussi : elle se tient ICI,
# pas dans la console, pour la même raison que le reste de ce dossier — on la
# lit dans un fichier, et un `plan` dit ce qui va changer avant que ça change.
#
# ⚠️ SPF ET DMARC SONT UNIQUES PAR DOMAINE. Le jour où l'application envoie
# depuis `hodoslift.com` (Scaleway TEM, `scaleway_email.tf`), le SPF doit
# porter les DEUX émetteurs, ou l'application envoie depuis un sous-domaine.
# Un second TXT `v=spf1` à l'apex n'additionne rien : il invalide les deux.
# ============================================================================

locals {
  # Les DKIM que Proton génère pour CE domaine ; vides tant qu'on ne les a pas.
  proton_dkim = { for sel, cible in var.proton_dkim : sel => cible if cible != "" }
}

resource "scaleway_domain_record" "proton_verification" {
  dns_zone = var.domaine_mail
  name     = ""
  type     = "TXT"
  data     = "protonmail-verification=${var.proton_verification}"
  ttl      = 3600
}

resource "scaleway_domain_record" "proton_mx_principal" {
  dns_zone = var.domaine_mail
  name     = ""
  type     = "MX"
  data     = "mail.protonmail.ch."
  priority = 10
  ttl      = 3600
}

resource "scaleway_domain_record" "proton_mx_secours" {
  dns_zone = var.domaine_mail
  name     = ""
  type     = "MX"
  data     = "mailsec.protonmail.ch."
  priority = 20
  ttl      = 3600
}

resource "scaleway_domain_record" "spf" {
  dns_zone = var.domaine_mail
  name     = ""
  type     = "TXT"
  data     = "v=spf1 include:_spf.protonmail.ch mx ~all"
  ttl      = 3600
}

# `quarantine` et non `reject` tant que DKIM n'est pas posé : un DMARC strict
# sans DKIM met son propre courrier en indésirable.
resource "scaleway_domain_record" "dmarc" {
  dns_zone = var.domaine_mail
  name     = "_dmarc"
  type     = "TXT"
  data     = "v=DMARC1; p=quarantine"
  ttl      = 3600
}

resource "scaleway_domain_record" "proton_dkim" {
  for_each = local.proton_dkim
  dns_zone = var.domaine_mail
  name     = "${each.key}._domainkey"
  type     = "CNAME"
  data     = "${trimsuffix(each.value, ".")}."
  ttl      = 3600
}
