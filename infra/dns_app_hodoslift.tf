# app.hodoslift.com — l'adresse de l'application, servie par le même site Firebase
# Hosting que trainer.french-forge.com (`french-forge-600`).
#
# Un CNAME vers l'adresse par défaut du site : c'est ce que Firebase demande en
# configuration rapide, et il en tire seul le certificat. Le domaine est déclaré
# côté Firebase (Hosting → domaines personnalisés), hors Terraform.
resource "scaleway_domain_record" "app" {
  dns_zone = var.domaine_mail
  name     = "app"
  type     = "CNAME"
  data     = "french-forge-600.web.app."
  ttl      = 3600
}
