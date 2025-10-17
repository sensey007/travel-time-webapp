# Terraform Infra for Travel Time Web App

## Resources
- Artifact Registry (Docker) repository
- Secret Manager secret for MAPS_API_KEY
- Cloud Run service (public invoker)

## Usage
```bash
export TF_VAR_project_id=seismic-bonfire-475018-m7
export TF_VAR_maps_api_key=YOUR_KEY
export TF_VAR_image_tag=us-central1-docker.pkg.dev/seismic-bonfire-475018-m7/travel-time-repo/webapp:latest
terraform init
terraform apply -auto-approve
```

After apply, output shows `service_url`.

## Updating Image
Re-build & push new image, then run:
```bash
terraform taint google_cloud_run_service.web
terraform apply -auto-approve
```
(Or update `image_tag` variable and apply.)

## Variables
See `variables.tf` for defaults (region us-central1, scaling params). Adjust `min_instances` to 0 to allow scale-to-zero.

## Security
`invoker_public` grants `roles/run.invoker` to allUsers (public). Remove that resource to make service private.


