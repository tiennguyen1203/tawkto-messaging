#!/usr/bin/env bash
#
# Brings the whole thing up, in the order it has to happen.
#
#   pnpm stack:up
#
# Six commands with two waits between them is six chances to run one out of order,
# and the failure when you do is obscure — a consumer that dies on a missing topic,
# an index that was never created. This is the same six, in the only order that
# works, with the waiting done properly rather than by a sleep.
#
# Everything it runs is idempotent, so running it again is how you recover from a
# half-finished start.
set -euo pipefail

cd "$(dirname "$0")/.."

INFRA=(mongo redis kafka kafka-connect elasticsearch)
say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  cp .env.example .env
  say "Wrote .env from .env.example"
fi

say "Starting MongoDB, Redis, Kafka, Kafka Connect and Elasticsearch"
docker compose up -d "${INFRA[@]}"

say "Waiting for them to report healthy"
deadline=$(( $(date +%s) + 300 ))
for service in "${INFRA[@]}"; do
  container="$(docker compose ps -q "$service")"
  while true; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && break
    if [ "$(date +%s)" -gt "$deadline" ]; then
      echo "  $service is still '$status' after 5 minutes. Check: docker compose logs $service" >&2
      exit 1
    fi
    sleep 1
  done
  echo "  $service ✓"
done

# The three provisioning tools are TypeScript and run from here, not from the image:
# the production stage installs runtime dependencies only. `migrate` is the exception
# and has its own compose service, because migrate-mongo is a runtime dependency.
say "Applying MongoDB migrations"
docker compose --profile migrate run --rm migrate

say "Creating the Elasticsearch index and Kafka topics, and registering the connector"
pnpm es:apply-templates
pnpm kafka:create-topics
pnpm debezium:register

say "Building and starting the API, the indexer and the demo UI"
docker compose --profile app up -d --build

printf '\n\033[1mReady.\033[0m\n'
printf '  Demo UI       http://localhost:%s\n' "${DEMO_UI_PORT:-8088}"
printf '  Messaging     http://localhost:%s/swagger\n' "${PORT:-3000}"
printf '  Identity      http://localhost:%s/api/health\n' "${IDENTITY_PORT:-3001}"
printf '  Elasticsearch http://localhost:%s   (UI)\n' "${ELASTICVUE_PORT:-8089}"
printf '  MongoDB       mongodb://localhost:%s/messaging?directConnection=true\n' "${MONGO_HOST_PORT:-27018}"
printf '\nOpen the demo UI, use the switcher in the top right to make a tenant and two\npeople, and start a chat.\n'
