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

BUILD_TARGET="${TAURI_BUILD_TARGET:-universal-apple-darwin}"

ensure_rust_target() {
  local target_triple="$1"

  if rustup target list --installed | grep -qx "${target_triple}"; then
    return 0
  fi

  echo "Installing Rust target ${target_triple}..."
  rustup target add "${target_triple}"
}

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

notarize_artifact() {
  local artifact_path="$1"

  echo "Notarizing ${artifact_path}..."

  if [[ "${HAS_API_KEY_FLOW}" -eq 1 ]]; then
    xcrun notarytool submit "${artifact_path}" \
      --key "${APPLE_API_KEY_PATH}" \
      --key-id "${APPLE_API_KEY}" \
      --issuer "${APPLE_API_ISSUER}" \
      --wait
  else
    xcrun notarytool submit "${artifact_path}" \
      --apple-id "${APPLE_ID}" \
      --password "${APPLE_PASSWORD}" \
      --team-id "${APPLE_TEAM_ID}" \
      --wait
  fi

  echo "Stapling ${artifact_path}..."
  xcrun stapler staple "${artifact_path}"
}

if [[ "${BUILD_TARGET}" == "universal-apple-darwin" ]]; then
  ensure_rust_target "aarch64-apple-darwin"
  ensure_rust_target "x86_64-apple-darwin"
  BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/universal-apple-darwin/release/bundle"
else
  ensure_rust_target "${BUILD_TARGET}"
  BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/${BUILD_TARGET}/release/bundle"
fi

echo "Building signed and notarized macOS app for ${BUILD_TARGET}..."
npm run tauri:build -- --target "${BUILD_TARGET}"

shopt -s nullglob
dmg_artifacts=("${BUNDLE_DIR}"/dmg/*.dmg)
shopt -u nullglob

for dmg_artifact in "${dmg_artifacts[@]}"; do
  notarize_artifact "${dmg_artifact}"
done

echo
echo "Build finished. Check:"
echo "  ${BUNDLE_DIR}"
