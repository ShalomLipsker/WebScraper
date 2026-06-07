# Kubernetes Deployment

## Contents

- `k8s/base`: namespace, shared application config, and manifests for `api`, `job-manager`, and `scraper`.
- `k8s/overlays/local`: application overlay for local or development clusters.
- `k8s/overlays/local/infra`: optional infrastructure overlay containing PostgreSQL, RabbitMQ, MinIO, and persistent volume claims.

## Images

Build the application images:

```bash
docker build -f Dockerfile.app \
  --build-arg APP_NAME=job-manager \
  --build-arg APP_PORT=3001 \
  --build-arg APP_ENTRYPOINT=apps/job-manager/dist/main.js \
  -t webscraper-job-manager:latest .
docker build -f Dockerfile.app \
  --build-arg APP_NAME=scraper \
  --build-arg APP_PORT=3002 \
  --build-arg APP_ENTRYPOINT=apps/scraper/dist/main.js \
  -t webscraper-scraper:latest .
docker build -f Dockerfile.app \
  --build-arg APP_NAME=api \
  --build-arg APP_PORT=3000 \
  --build-arg APP_ENTRYPOINT=apps/api/dist/main.js \
  -t webscraper-api:latest .
```

Build the RabbitMQ image if the infrastructure overlay will be used:

```bash
docker build -f Dockerfile.rabbitmq -t webscraper-rabbitmq:latest .
```

## Secret Stub

Populate `k8s/overlays/local/webscraper-secrets.env` with the required values:

- `POSTGRES_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `RABBITMQ_URL`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_ROOT_USER`
- `S3_ROOT_PASSWORD`

## Application Deployment

Apply the application overlay:

```bash
kubectl apply -k k8s/overlays/local
```

Access the API locally:

```bash
kubectl -n webscraper port-forward svc/api 3000:3000
```

## Optional Infrastructure Deployment

Apply the infrastructure overlay:

```bash
kubectl apply -k k8s/overlays/local/infra
```

## Configuration

Application defaults are defined in `k8s/base/configmap.yaml`.
Environment-specific secret values are defined in `k8s/overlays/local/webscraper-secrets.env`.