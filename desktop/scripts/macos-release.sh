#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_ENV_FILE="${DESKTOP_DIR}/.env.macos.local"

if [[ -f "${LOCAL_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_ENV_FILE}"
  set +a
fi

cd "${DESKTOP_DIR}"

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Missing APPLE_SIGNING_IDENTITY."
  echo "Fill desktop/.env.macos.local from desktop/.env.macos.example."
  exit 1
fi

HAS_API_KEY_FLOW=0
if [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  HAS_API_KEY_FLOW=1
fi

HAS_APPLE_ID_FLOW=0
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  HAS_APPLE_ID_FLOW=1
fi

if [[ "${HAS_API_KEY_FLOW}" -ne 1 && "${HAS_APPLE_ID_FLOW}" -ne 1 ]]; then
  echo "Missing notarization credentials."
  echo "Provide either:"
  echo "  APPLE_API_ISSUER + APPLE_API_KEY + APPLE_API_KEY_PATH"
  echo "or:"
  echo "  APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID"
  exit 1
fi

echo "Building signed and notarized macOS app..."
npm run tauri:build

echo
echo "Build finished. Check:"
echo "  ${DESKTOP_DIR}/src-tauri/target/release/bundle/"
