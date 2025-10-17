variable "project_id" { type = string }
variable "region" { type = string  default = "us-central1" }
variable "maps_api_key" { type = string  description = "Google Maps API key" }
variable "repo_name" { type = string  default = "travel-time-repo" }
variable "service_name" { type = string  default = "travel-time-webapp" }
variable "min_instances" { type = number default = 1 }
variable "max_instances" { type = number default = 10 }
variable "concurrency" { type = number default = 80 }
variable "memory" { type = string default = "512Mi" }
variable "cpu" { type = string default = "1" }
variable "image_tag" { type = string description = "Full Artifact Registry image URI (built externally)" }

