#!/bin/sh

set -eu

alias_name="${MINIO_ALIAS:-local}"
endpoint="${MINIO_ENDPOINT:-http://minio:9000}"
access_key="${MINIO_ROOT_USER:-minio}"
secret_key="${MINIO_ROOT_PASSWORD:-minio123}"
bucket="${MINIO_BUCKET:-html-scraped-jobs}"
expire_days="${MINIO_LIFECYCLE_EXPIRE_DAYS:-1}"

until mc alias set "$alias_name" "$endpoint" "$access_key" "$secret_key" >/dev/null 2>&1; do
  echo 'waiting for minio'
  sleep 1
done

mc mb --ignore-existing "$alias_name/$bucket"

# Avoid duplicating rules on repeated bootstrap runs while still enforcing the
# required 24-hour retention rule for the scrape results bucket.
lifecycle_rules="$(mc ilm rule ls "$alias_name/$bucket" 2>/dev/null || true)"

if [ -n "$lifecycle_rules" ]; then
  echo "lifecycle rule already configured for $bucket"
else
  mc ilm rule add --expire-days "$expire_days" "$alias_name/$bucket"
fi