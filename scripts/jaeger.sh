#!/usr/bin/env bash
# Push the .dagger otel-dump NDJSON traces into a local Jaeger v2 via OTLP/HTTP.
# Usage: devbox run jaeger   (or: bash scripts/jaeger.sh [dump-dir])
# No intermediate otel.json — scripts/traces-to-otlp.mjs pipes straight into curl.
set -e

DUMP_DIR="${1:-${DUMP_DIR:-./otel-dump}}"

node scripts/traces-to-otlp.mjs "$DUMP_DIR" |
  curl -fsS -X POST http://localhost:4318/v1/traces \
    -H 'Content-Type: application/json' --data-binary @-

echo 'traces pushed to Jaeger — open http://localhost:16686'
