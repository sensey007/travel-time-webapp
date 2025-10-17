# Deployment Guide

This document describes multiple ways to deploy the Travel Time Web App.

## 1. Environment Variables
| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| MAPS_API_KEY | Yes (prod) | Google Maps / Directions / Distance Matrix API key | AIza... |
| PORT | No | HTTP listen port (default 3000) | 8080 |
| APP_VERSION | No | Override version reported in /healthz | 1.0.0 |
| COMMIT_SHA | No | Git commit hash for traceability | a1b2c3d |
| LOG_LEVEL | No | one of error,warn,info,debug (default info) | debug |
| NODE_ENV | No | Set to production in prod | production |

(Internal HTTPS support removed. Use a reverse proxy / ingress for TLS termination.)

## 2. Production Docker Image
Multi-stage build (current Dockerfile is simple). For an even smaller image:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O - http://127.0.0.1:3000/healthz || exit 1
CMD ["node","server.js"]
```

Build & run:
```bash
docker build -t your-org/travel-time-webapp:1.0.0 .
docker run -d --name travel-time \
  -e MAPS_API_KEY=$MAPS_API_KEY \
  -e APP_VERSION=1.0.0 -e COMMIT_SHA=$(git rev-parse --short HEAD) \
  -p 8080:3000 your-org/travel-time-webapp:1.0.0
```

## 3. Docker Compose (Dev / Simple Deploy)
```yaml
version: '3.8'
services:
  travel-time:
    build: .
    container_name: travel-time
    environment:
      MAPS_API_KEY: ${MAPS_API_KEY}
      NODE_ENV: production
      LOG_LEVEL: info
    ports:
      - "8080:3000"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:3000/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
```
Run: `MAPS_API_KEY=XXX docker compose up -d --build`.

## 4. Systemd (Bare Metal / VM)
Create `/etc/systemd/system/travel-time.service`:
```
[Unit]
Description=Travel Time Web App
After=network.target

[Service]
Environment=MAPS_API_KEY=REPLACE
Environment=NODE_ENV=production
Environment=APP_VERSION=1.0.0
Environment=COMMIT_SHA=local-dev
WorkingDirectory=/opt/travel-time
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```
Enable & start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now travel-time
```

## 5. Nginx Reverse Proxy (TLS Termination)
Example `/etc/nginx/conf.d/travel-time.conf`:
```
server {
  listen 443 ssl;
  server_name travel.example.com;
  ssl_certificate /etc/letsencrypt/live/travel.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/travel.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```
Optionally add rate limiting on `/api/` endpoints.

## 6. Kubernetes (Minimal Example)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: travel-time
spec:
  replicas: 2
  selector:
    matchLabels:
      app: travel-time
  template:
    metadata:
      labels:
        app: travel-time
    spec:
      containers:
        - name: web
          image: your-org/travel-time-webapp:1.0.0
          env:
            - name: MAPS_API_KEY
              valueFrom:
                secretKeyRef:
                  name: maps-api
                  key: key
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 15
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: travel-time
spec:
  selector:
    app: travel-time
  ports:
    - port: 80
      targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: travel-time
spec:
  rules:
    - host: travel.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: travel-time
                port:
                  number: 80
```
Create secret:
```bash
kubectl create secret generic maps-api --from-literal=key=$MAPS_API_KEY
```

## 7. Observability
- Health: `GET /healthz` (add external uptime check)
- Logs: JSON structured logs (level, path, status, ms). Aggregate via ELK or Loki.
- Future: Add `/metrics` (Prometheus). Suggest adding express-prometheus-middleware.

## 8. Security Hardening
- Restrict Google API key (HTTP referrer restrictions if pure client; or IP / service account if only server-side).
- Prefer `useProxy=true` so keys never reach clients.
- Rate limit `/api/directions` and `/api/matrix` (e.g., express-rate-limit) to reduce quota abuse.
- Enable Helmet for security headers.
- Add HMAC signature or token for internal voice service linking (optional future).

## 9. CI/CD (GitHub Actions Example)
Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [ main ]
  pull_request:
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run lint
  docker-image:
    needs: build-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Docker login
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & Push
        run: |
          IMAGE=ghcr.io/${{ github.repository }}/travel-time-webapp:$(git rev-parse --short HEAD)
          docker build -t $IMAGE --build-arg COMMIT_SHA=$(git rev-parse --short HEAD) .
          docker push $IMAGE
```

## 10. Rolling Update Strategy Tips (K8s)
- Set liveness & readiness probes (already shown).
- Use `maxSurge: 1` / `maxUnavailable: 0` for zero-downtime.
- Optionally implement preStop hook (not critical for stateless).

## 11. Manual Smoke Test Steps
After deployment:
```bash
curl -fsSL http://travel.example.com/healthz | jq
# Expect status ok, version, commitSha
open "http://travel.example.com/tt?origin=Philadelphia,PA&destination=JFK%20Airport&useProxy=true&traffic=true&refreshSec=60"
```

## 12. Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| 500 Server missing MAPS_API_KEY | Not set or empty | Set env variable / secret |
| Directions providerStatus ZERO_RESULTS | Invalid address pair | Verify origin/destination formatting |
| Slow first response | Cold DNS / container start | Keep >=1 warm replica |
| Traffic ETA missing | Using client mode or non-driving | Use `useProxy=true&traffic=true&mode=driving` |

## 13. Next Hardening Steps (Optional)
- Introduce request ID header (e.g., `X-Request-ID`).
- Add caching (LRU) around proxy results.
- Implement HMAC validation for deep links.
- Add integration tests hitting `/api/directions` via a mocked network layer.

## 14. Google Cloud Run Deployment (Serverless Option)
Google Cloud Run runs containers on a fully managed, request-scaled infrastructure. It supports our Node.js HTTP server out-of-the-box.

### 14.1 Quick Start (No Manual Image Build)
If you just want to deploy source directly (Cloud Build builds the image automatically):
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
# Deploy from source directory (buildpack style)
MAPS_API_KEY=YOUR_KEY
# Store key in Secret Manager (recommended)
echo -n "$MAPS_API_KEY" | gcloud secrets create maps-api-key --data-file=- --replication-policy=automatic
# Grant default compute SA access to secret (so Cloud Run can read it)
PROJECT_NUM=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding maps-api-key \
  --member=serviceAccount:$PROJECT_NUM-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
# Deploy (Cloud Run automatically sets PORT)
gcloud run deploy travel-time-webapp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets MAPS_API_KEY=maps-api-key:latest \
  --set-env-vars LOG_LEVEL=info,NODE_ENV=production \
  --min-instances=1 --max-instances=10 \
  --concurrency=80 --memory=512Mi --cpu=1 --timeout=60s
```
This will output a service URL like `https://travel-time-webapp-xxxxx-uc.a.run.app`. Test health:
```bash
curl -fsSL https://SERVICE_URL/healthz | jq
```

### 14.2 Docker Image Path (Artifact Registry)
For explicit Dockerfile build:
```bash
REGION=us-central1
REPO=travel-time-repo
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION --description="Travel Time images"
PROJECT_ID=$(gcloud config get-value project)
IMAGE_URI=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/webapp:$(git rev-parse --short HEAD)
gcloud builds submit --tag $IMAGE_URI .
```
Then deploy:
```bash
gcloud run deploy travel-time-webapp \
  --image $IMAGE_URI \
  --region $REGION \
  --allow-unauthenticated \
  --set-secrets MAPS_API_KEY=maps-api-key:latest \
  --set-env-vars LOG_LEVEL=info,NODE_ENV=production \
  --min-instances=1 --max-instances=10 --concurrency=80 --memory=512Mi --cpu=1
```

### 14.3 Environment / Secrets Strategy
Use Secret Manager instead of plain env for MAPS_API_KEY so logs won't accidentally expose key. The server only reads `process.env.MAPS_API_KEY`.

### 14.4 Image Endpoints Testing
```bash
SERVICE_URL=$(gcloud run services describe travel-time-webapp --region us-central1 --format='value(status.url)')
# Travel route JSON
curl "$SERVICE_URL/api/staticmap/travel?origin=Philadelphia,PA&destination=JFK%20Airport" | jq
# Travel route image
curl -o travel.png "$SERVICE_URL/api/staticmap/travel/image?origin=Philadelphia,PA&destination=JFK%20Airport&scale=2"
file travel.png
# NearbyFood list
curl "$SERVICE_URL/api/staticmap/food?origin=19103&cuisine=italian&limit=5" | jq '.results[0]'
# NearbyFood image
curl -o food.png "$SERVICE_URL/api/staticmap/food/image?origin=19103&cuisine=italian&limit=5&zoom=14"
```

### 14.5 Custom Domain
```bash
gcloud run domain-mappings create --service travel-time-webapp --domain travel.example.com --region us-central1
# Configure DNS per instructions output by command (CNAME or A). Test:
curl https://travel.example.com/healthz
```

### 14.6 Scaling Recommendations
| Setting | Value | Reason |
|---------|-------|--------|
| min-instances | 1 | Reduce cold start latency for voice interactions |
| max-instances | 10 (adjust) | Prevent runaway cost / quota usage |
| concurrency | 80 | Node.js I/O handles many simultaneous requests |
| memory | 512Mi | Enough for parsing Places/Directions responses |
| cpu | 1 | Lightweight; increase if heavy CPU parsing added later |

### 14.7 Observability
- Logs automatically go to Cloud Logging (structured JSON). Filter by `resource.labels.service_name="travel-time-webapp"`.
- Consider adding a `/metrics` endpoint later + Cloud Monitoring custom metrics.

### 14.8 IAM Lockdown (Optional)
Remove `--allow-unauthenticated` and manage access via IAM `roles/run.invoker` if the service is only invoked internally (e.g., via gateway). For public voice prototype, unauthenticated is acceptable.

### 14.9 Blue/Green Revision Rollouts
Deploy new image; Cloud Run creates new revision. Traffic splits available:
```bash
gcloud run services update-traffic travel-time-webapp --region us-central1 --to-revisions RevisionA=50,RevisionB=50
```
Validate new revision before shifting 100%.

### 14.10 Common Cloud Run Issues
| Problem | Symptom | Resolution |
|---------|---------|------------|
| Missing MAPS_API_KEY | 500 error "Server missing MAPS_API_KEY" | Ensure secret mapped or env set |
| Cold start delay | First request slow (~1s+) | Set min-instances=1 |
| Quota errors 429/502 | Upstream Google API quota reached | Add caching, reduce calls per request |
| Unexpected 403 from Places | Key restrictions mismatch | Adjust API key restrictions (remove HTTP referrer if server-side) |
| 404 healthz | Wrong port or crash loop | Check logs, confirm listening on `PORT` env |

### 14.11 CI/CD Shortcut (cloudbuild.yaml)
Add a `cloudbuild.yaml` and deploy via Cloud Build trigger for each commit to main.

### 14.12 Cost Awareness
Free tier often covers prototype usage. Monitor with:
```bash
gcloud run services describe travel-time-webapp --region us-central1 --format='value(spec.template.spec.containers[0].resources)'
gcloud billing accounts list
```
Set budget alerts if scaling up.

### 14.13 Future Enhancements on Cloud Run
- Add CDN (Cloud CDN + Load Balancer) for static map image caching.
- Introduce Redis (memorystore) for results caching (reduce Google API calls).
- Add Cloud Armor rules for suspicious scanner paths (.do/.action etc.).

---
End Cloud Run Section.

## 15. Automated CI/CD & IaC Artifacts
Added files:
- `cloudbuild.yaml`: Cloud Build pipeline (build, push, deploy). Create a trigger in GCP pointing to main branch; substitutions control region/service.
- `infra/terraform/`: Terraform stack (`main.tf`, `variables.tf`, `README.md`) to provision Artifact Registry, Secret Manager, and Cloud Run service.

### 15.1 Cloud Build Trigger Creation
```bash
gcloud builds triggers create github \
  --name=travel-time-webapp-deploy \
  --repo-owner=YOUR_GITHUB_ORG \
  --repo-name=YOUR_REPO_NAME \
  --branch-pattern=^main$ \
  --build-config=cloudbuild.yaml
```
Ensure secret `maps-api-key` exists before first deploy.

### 15.2 Terraform Quick Start
See `infra/terraform/README.md` for usage. Sample:
```bash
cd infra/terraform
terraform init
terraform apply -auto-approve \
  -var project_id=seismic-bonfire-475018-m7 \
  -var maps_api_key=$MAPS_API_KEY \
  -var image_tag=us-central1-docker.pkg.dev/seismic-bonfire-475018-m7/travel-time-repo/webapp:latest
```
