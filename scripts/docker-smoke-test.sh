#!/usr/bin/env bash
#
# Docker Smoke Test
#
# Builds a Docker image and verifies the app starts and responds to HTTP requests.
# Use this locally or in CI to catch production-breaking changes early.
#
# Usage:
#   ./scripts/docker-smoke-test.sh              # Build and test
#   HOST_PORT=9090 ./scripts/docker-smoke-test.sh  # Use a custom port
#   REMOVE_IMAGE=true ./scripts/docker-smoke-test.sh  # Clean up image after test
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
IMAGE_NAME="mento-analytics-api-smoke-test"
CONTAINER_NAME="mento-analytics-api-smoke-test"
HOST_PORT="${HOST_PORT:-8081}" # 8081 to avoid conflicts with local dev on 8080
CONTAINER_PORT=8080
MAX_RETRIES=30
RETRY_INTERVAL=2 # seconds

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# Cleanup on exit
# ---------------------------------------------------------------------------
cleanup() {
	log_info "Cleaning up..."
	docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
	if [[ ${REMOVE_IMAGE:-false} == "true" ]]; then
		docker rmi "${IMAGE_NAME}" 2>/dev/null || true
	fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
	log_error "Docker is not installed or not in PATH"
	exit 1
fi

if ! docker info &>/dev/null; then
	log_error "Docker daemon is not running"
	exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: Build the Docker image
# ---------------------------------------------------------------------------
log_info "Building Docker image '${IMAGE_NAME}'..."
docker build -t "${IMAGE_NAME}" .

# ---------------------------------------------------------------------------
# Step 2: Start the container
# ---------------------------------------------------------------------------
log_info "Starting container on port ${HOST_PORT}..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

# Provide minimal env vars so the app can boot.
# Public endpoints from .env.example and dummy API keys (never used for real calls).
docker run -d \
	--name "${CONTAINER_NAME}" \
	-p "${HOST_PORT}:${CONTAINER_PORT}" \
	-e NODE_ENV=production \
	-e PORT="${CONTAINER_PORT}" \
	-e CACHE_WARMING_ENABLED=false \
	-e CELO_RPC_URL=wss://forno.celo.org/ws \
	-e ETH_RPC_URL=wss://mainnet.gateway.tenderly.co \
	-e BLOCKCHAIN_INFO_API_URL=https://api.blockchain.info/v3 \
	-e BLOCKSTREAM_API_URL=https://blockstream.info/api \
	-e COINMARKETCAP_API_URL=https://pro-api.coinmarketcap.com/v1 \
	-e COINMARKETCAP_API_KEY=smoke-test-dummy-key \
	-e EXCHANGE_RATES_API_URL=https://api.exchangeratesapi.io/v1 \
	-e EXCHANGE_RATES_API_KEY=smoke-test-dummy-key \
	"${IMAGE_NAME}"

# ---------------------------------------------------------------------------
# Step 3: Wait for the app to become ready
# ---------------------------------------------------------------------------
log_info "Waiting for the app to respond (up to $((MAX_RETRIES * RETRY_INTERVAL))s)..."

for i in $(seq 1 "${MAX_RETRIES}"); do
	# Try hitting /docs — the Swagger UI endpoint has no external dependencies
	if curl -sf --max-time 3 "http://localhost:${HOST_PORT}/docs" >/dev/null 2>&1; then
		log_info "App is responding (attempt ${i}/${MAX_RETRIES})"
		break
	fi

	# Bail early if the container crashed
	if ! docker ps -q -f "name=${CONTAINER_NAME}" | grep -q .; then
		log_error "Container exited unexpectedly!"
		echo "--- Container logs ---"
		docker logs "${CONTAINER_NAME}"
		exit 1
	fi

	if [[ ${i} -eq ${MAX_RETRIES} ]]; then
		log_error "App did not respond after ${MAX_RETRIES} attempts ($((MAX_RETRIES * RETRY_INTERVAL))s)"
		echo "--- Container logs ---"
		docker logs "${CONTAINER_NAME}"
		exit 1
	fi

	sleep "${RETRY_INTERVAL}"
done

# ---------------------------------------------------------------------------
# Step 4: Verify Swagger docs (proves NestJS bootstrapped correctly)
# ---------------------------------------------------------------------------
log_info "Checking Swagger docs endpoint..."

DOCS_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${HOST_PORT}/docs" 2>&1) || true
if [[ ${DOCS_STATUS} == "200" ]] || [[ ${DOCS_STATUS} == "301" ]]; then
	log_info "Swagger docs returned HTTP ${DOCS_STATUS}"
else
	log_error "Swagger docs returned unexpected HTTP ${DOCS_STATUS}"
	echo "--- Container logs ---"
	docker logs "${CONTAINER_NAME}"
	exit 1
fi

# ---------------------------------------------------------------------------
# Step 5: Verify health endpoint (proves API routes are wired up)
# ---------------------------------------------------------------------------
log_info "Checking health endpoint..."

# The health endpoint makes external API calls, so individual checks may fail
# without real API keys. We only care that the endpoint itself responds with JSON.
HEALTH_RESPONSE=$(curl -sf --max-time 30 "http://localhost:${HOST_PORT}/api/v1/health" 2>&1) || true

if [[ -n ${HEALTH_RESPONSE} ]]; then
	if echo "${HEALTH_RESPONSE}" | python3 -c "import sys, json; data = json.load(sys.stdin); print(json.dumps(data, indent=2))" 2>/dev/null; then
		log_info "Health endpoint returned valid JSON"
	else
		log_warn "Health endpoint responded but returned non-JSON: ${HEALTH_RESPONSE:0:200}"
	fi
else
	log_warn "Health endpoint did not respond (external service timeouts are expected without API keys)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
log_info "Docker smoke test passed! The app builds and starts correctly inside the container."
