terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Artifact Registry repository (Docker)
resource "google_artifact_registry_repository" "repo" {
  location        = var.region
  repository_id   = var.repo_name
  format          = "DOCKER"
  description     = "Travel Time Web App images"
}

# Secret for MAPS_API_KEY
resource "google_secret_manager_secret" "maps" {
  secret_id = "maps-api-key"
  replication { automatic = true }
}
resource "google_secret_manager_secret_version" "maps_v" {
  secret      = google_secret_manager_secret.maps.id
  secret_data = var.maps_api_key
}

# Cloud Run service
resource "google_cloud_run_service" "web" {
  name     = var.service_name
  location = var.region
  template {
    metadata { annotations = {
      "autoscaling.knative.dev/minScale" = tostring(var.min_instances)
      "autoscaling.knative.dev/maxScale" = tostring(var.max_instances)
    } }
    spec {
      container_concurrency = var.concurrency
      containers {
        image = var.image_tag
        resources { limits = { memory = var.memory, cpu = var.cpu } }
        env { name = "LOG_LEVEL" value = "info" }
        env { name = "NODE_ENV" value = "production" }
        env { name = "APP_VERSION" value = var.image_tag }
        env { name = "COMMIT_SHA" value = var.image_tag }
        env { name = "MAPS_API_KEY" value_from { secret_key_ref { name = google_secret_manager_secret.maps.secret_id key = "latest" } } }
        ports { container_port = 3000 }
      }
    }
  }
  traffic { percent = 100 latest_revision = true }
}

resource "google_cloud_run_service_iam_member" "invoker_public" {
  service  = google_cloud_run_service.web.name
  location = google_cloud_run_service.web.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" { value = google_cloud_run_service.web.status[0].url }

