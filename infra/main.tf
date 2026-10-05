terraform {
  required_version = ">= 1.5"

  # State distant (bucket créé À LA MAIN, hors cycle Terraform — bootstrap
  # œuf-et-poule). Versioning activé sur le bucket → rollback possible.
  backend "gcs" {
    bucket = "french-forge-600-tfstate"
    prefix = "nidavellir"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
    # ⚠️ VERSION EXACTE, ET C'EST DÉLIBÉRÉ (FRE-151). Ajouter un provider oblige
    # à un `terraform init`, et celui-ci a fait glisser celui-ci de 0.14.0 à
    # 0.17.0 sans qu'on le demande — `~> 0.6` l'autorise. Or c'est le provider
    # qui gère le PROJET Neon, celui qui porte deux à trois ans d'entraînement
    # et un `prevent_destroy`. Une montée de version s'y décide, elle ne se subit
    # pas au détour d'un `init`.
    neon = {
      source  = "kislerdm/neon"
      version = "0.14.0"
    }
    # Le mot de passe du rôle APPLICATIF (FRE-151) : Terraform le fabrique et le
    # dépose dans Secret Manager, mais ne crée pas le rôle — voir `neon.tf`.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    # Le stockage des médias vit chez Scaleway depuis le 25/08 (FRE-99) —
    # premier morceau d'infra hors GCP, cf. `scaleway.tf`.
    # Épinglé pour la même raison : le même `init` l'a monté de 2.81.0 à 2.82.0.
    scaleway = {
      source  = "scaleway/scaleway"
      version = "2.81.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "firebase.googleapis.com",
    "firebasestorage.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}
