#!/usr/bin/env bash
set -euo pipefail

# Build Editian Docker images and export them as a single compressed tarball
# suitable for transfer to an air-gapped VM.
#
# Usage:
#   ./scripts/build-airgap-images.sh
#   ./scripts/build-airgap-images.sh /path/to/editian-airgap-images.tar.gz
#
# Optional environment variables:
#   FRONTEND_IMAGE=editian-frontend:airgap
#   BACKEND_IMAGE=editian-backend:airgap
#   PLATFORM=linux/amd64        # useful when building on Apple Silicon for x86 VMs
#   NO_CACHE=1                 # build without Docker cache

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-editian-frontend:airgap}"
BACKEND_IMAGE="${BACKEND_IMAGE:-editian-backend:airgap}"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Build Editian Docker images and export them as a single compressed tarball
suitable for transfer to an air-gapped VM.

Usage:
  ./scripts/build-airgap-images.sh
  ./scripts/build-airgap-images.sh /path/to/editian-airgap-images.tar.gz

Optional environment variables:
  FRONTEND_IMAGE=editian-frontend:airgap
  BACKEND_IMAGE=editian-backend:airgap
  PLATFORM=linux/amd64        # useful when building on Apple Silicon for x86 VMs
  NO_CACHE=1                 # build without Docker cache
EOF
  exit 0
fi

OUTPUT="${1:-$ROOT_DIR/editian-airgap-images-$(date +%Y%m%d-%H%M%S).tar.gz}"

BUILD_ARGS=()
if [[ -n "${PLATFORM:-}" ]]; then
  BUILD_ARGS+=(--platform "$PLATFORM")
fi
if [[ "${NO_CACHE:-}" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
fi

echo "Project root: $ROOT_DIR"
echo "Frontend image: $FRONTEND_IMAGE"
echo "Backend image:  $BACKEND_IMAGE"
echo "Output archive: $OUTPUT"
if [[ -n "${PLATFORM:-}" ]]; then
  echo "Platform:       $PLATFORM"
fi

echo
echo "Building frontend image..."
docker build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} --target frontend-runtime -t "$FRONTEND_IMAGE" "$ROOT_DIR"

echo
echo "Building backend image..."
docker build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} --target backend-runtime -t "$BACKEND_IMAGE" "$ROOT_DIR"

echo
echo "Saving images to compressed archive..."
mkdir -p "$(dirname "$OUTPUT")"
docker save "$FRONTEND_IMAGE" "$BACKEND_IMAGE" | gzip -9 > "$OUTPUT"

echo
echo "Done: $OUTPUT"
echo
echo "Transfer with:"
echo "  rsync -avP '$OUTPUT' user@VM_IP:/opt/editian/"
echo
echo "Load on VM with:"
echo "  gunzip -c /opt/editian/$(basename "$OUTPUT") | docker load"
