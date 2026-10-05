# Observabilité brokkr — dashboard Cloud Monitoring alimenté par les audit logs
# applicatifs (jsonPayload.audit=true : resource/count/status) + les métriques
# Cloud Run natives. Pas d'alerte pour l'instant (revue manuelle du dashboard).
#
# ⚠️ Angle mort : ces métriques ne voient QUE le trafic passant par brokkr.
#
# CE QUE CET ANGLE MORT SIGNIFIE A CHANGÉ LE 16/08. Tant que Firestore était la
# source vivante, une écriture client directe modifiait la vraie donnée sans
# apparaître ici. Depuis la bascule de l'arbre d'entraînement (FRE-12), plus
# aucun client n'écrit dans Firestore — Eitri passe intégralement par brokkr, et
# la v2 est éteinte. Une écriture directe atterrirait donc dans un magasin que
# PLUS RIEN NE LIT : ce n'est plus une mutation invisible, c'est une perte
# silencieuse pour celui qui la fait.
#
# Conséquence : l'endgame (fermer firestore.rules pour que brokkr soit le seul
# chemin) n'est plus bloqué par personne — vérifié le 17/08, les règles sont
# toujours ouvertes en lecture/écriture client. Seule l'AUTHENTIFICATION doit
# rester intacte.

locals {
  brokkr_service = "brokkr"
}

# --- Log-based metrics -------------------------------------------------------

# Écritures médiées, ventilées par domaine (jsonPayload.resource) et statut.
resource "google_logging_metric" "brokkr_audit_writes" {
  name = "brokkr_audit_writes"
  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${local.brokkr_service}\"",
    "jsonPayload.audit=true",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "brokkr — écritures médiées"

    labels {
      key         = "domain"
      value_type  = "STRING"
      description = "Domaine d'écriture (jsonPayload.resource)"
    }
    labels {
      key         = "status"
      value_type  = "STRING"
      description = "ok / error"
    }
  }

  label_extractors = {
    domain = "EXTRACT(jsonPayload.resource)"
    status = "EXTRACT(jsonPayload.status)"
  }
}

# Taille des suppressions en cascade (jsonPayload.count) — pour repérer une
# suppression anormalement grosse avant qu'elle ne s'approche du cap serveur.
resource "google_logging_metric" "brokkr_delete_docs" {
  name = "brokkr_delete_docs"
  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${local.brokkr_service}\"",
    "jsonPayload.audit=true",
    "jsonPayload.count>0",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "brokkr — docs supprimés par requête"
  }

  value_extractor = "EXTRACT(jsonPayload.count)"

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 12
      growth_factor      = 2
      scale              = 1
    }
  }
}

# Échecs d'authentification (401/403) — signal de token invalide / probing.
# Basé sur les request logs Cloud Run (httpRequest.status), pas les audit logs.
resource "google_logging_metric" "brokkr_auth_failures" {
  name = "brokkr_auth_failures"
  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${local.brokkr_service}\"",
    "(httpRequest.status=401 OR httpRequest.status=403)",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "brokkr — échecs d'auth (401/403)"

    labels {
      key         = "code"
      value_type  = "STRING"
      description = "Code HTTP (401/403)"
    }
  }

  label_extractors = {
    code = "EXTRACT(httpRequest.status)"
  }
}

# --- Dashboard ---------------------------------------------------------------

resource "google_monitoring_dashboard" "brokkr" {
  depends_on = [google_project_service.apis]

  dashboard_json = jsonencode({
    displayName = "brokkr — backend applicatif"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "Requêtes / min (par classe de code)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"${local.brokkr_service}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"response_code_class\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "Latence requêtes (p50 / p95)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "LINE"
                  legendTemplate = "p95"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"${local.brokkr_service}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_PERCENTILE_95"
                      }
                    }
                  }
                },
                {
                  plotType       = "LINE"
                  legendTemplate = "p50"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"${local.brokkr_service}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_PERCENTILE_50"
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "Écritures médiées / min (par domaine)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_AREA"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/brokkr_audit_writes\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"domain\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "Erreurs d'écriture (status != ok)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/brokkr_audit_writes\" resource.type=\"cloud_run_revision\" metric.label.\"status\"!=\"ok\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"domain\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 8, width = 6, height = 4
          widget = {
            title = "Docs supprimés par requête (cascade)"
            xyChart = {
              dataSets = [{
                plotType = "HEATMAP"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/brokkr_delete_docs\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 8, width = 6, height = 4
          widget = {
            title = "Échecs d'auth 401/403 / min"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/brokkr_auth_failures\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"code\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          # Logs BRUTS (rétroactif, contrairement aux métriques) : le flux
          # d'audit complet. Sers-t'en pour investiguer un athlète — clique
          # « Filtrer » et ajoute jsonPayload.docPath=~"programs/<son programId>".
          xPos = 0, yPos = 12, width = 12, height = 5
          widget = {
            title = "Flux d'audit brut (filtrable par athlète)"
            logsPanel = {
              filter        = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"brokkr\" jsonPayload.audit=true"
              resourceNames = ["projects/${var.project_id}"]
            }
          }
        }
      ]
    }
  })

  # ⚠️ UNE DÉRIVE PERMANENTE QU'AUCUN `apply` NE RÉSORBE (2026-08-27).
  #
  # Ce tableau de bord apparaissait « to change » à CHAQUE plan, et l'appliquer
  # ne changeait rien : le plan suivant le remontrait. Ce n'est pas une
  # modification faite dans la console, c'est l'API qui NORMALISE ce qu'on lui
  # envoie, et le provider compare le JSON stocké au JSON écrit ici.
  #
  # Vérifié dans l'état plutôt que supposé — l'API rend :
  #   · `etag` et `name` en tête, absents d'ici par construction ;
  #   · les tuiles SANS `xPos`/`yPos` quand ils valent 0 (défaut proto3), alors
  #     que le code les écrit ;
  #   · un `targetAxis = "Y1"` ajouté à chaque `dataSet`, que le code n'écrit pas.
  #
  # ⚠️ ALIGNER LE CODE NE SUFFIRAIT PAS. On pourrait retirer les zéros et ajouter
  # les `targetAxis`, mais `etag` CHANGE À CHAQUE ÉCRITURE : la dérive
  # reviendrait, en plus petit. C'est pour ça qu'on ignore le champ au lieu de le
  # rapprocher.
  #
  # ⚠️ ET LE COÛT EST RÉEL, IL FAUT LE CONNAÎTRE : Terraform ne mettra plus ce
  # tableau de bord à jour. Le prix inverse était pire — un plan qui montre
  # toujours un changement apprend à ne plus lire les plans, et c'est ce
  # jour-là qu'on applique une destruction sans la voir.
  #
  # POUR MODIFIER LE TABLEAU DE BORD : commenter la ligne ci-dessous, `apply`,
  # puis la remettre. `-replace` marcherait aussi mais recrée la ressource, donc
  # change son identifiant — et l'URL de `brokkr_dashboard_url` avec lui.
  lifecycle {
    ignore_changes = [dashboard_json]
  }
}

output "brokkr_dashboard_url" {
  description = "Lien direct vers le dashboard brokkr"
  value       = "https://console.cloud.google.com/monitoring/dashboards/builder/${basename(google_monitoring_dashboard.brokkr.id)}?project=${var.project_id}"
}
