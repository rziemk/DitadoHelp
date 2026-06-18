#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${DESKTOP_DIR}/.." && pwd)"

cd "${REPO_DIR}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing GitHub CLI (gh)."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node."
  exit 1
fi

VERSION="$(node -p "require('${DESKTOP_DIR}/package.json').version")"
TAG="v${VERSION}"
TITLE="Scribeflowai ${TAG}"

shopt -s nullglob
DMG_ARTIFACTS=("${DESKTOP_DIR}"/src-tauri/target/*/release/bundle/dmg/*"_${VERSION}_"*.dmg)
if [[ "${#DMG_ARTIFACTS[@]}" -eq 0 ]]; then
  DMG_ARTIFACTS=("${DESKTOP_DIR}"/src-tauri/target/release/bundle/dmg/*"_${VERSION}_"*.dmg)
fi
shopt -u nullglob

if [[ "${#DMG_ARTIFACTS[@]}" -eq 0 ]]; then
  echo "No DMG artifacts found for version ${VERSION}."
  echo "Run npm run release:macos first."
  exit 1
fi

CHECKSUM_ARTIFACTS=()
for dmg_artifact in "${DMG_ARTIFACTS[@]}"; do
  checksum_path="${dmg_artifact}.sha256"
  shasum -a 256 "${dmg_artifact}" > "${checksum_path}"
  CHECKSUM_ARTIFACTS+=("${checksum_path}")
done

if gh release view "${TAG}" >/dev/null 2>&1; then
  gh release upload "${TAG}" "${DMG_ARTIFACTS[@]}" "${CHECKSUM_ARTIFACTS[@]}" --clobber
else
  gh release create "${TAG}" "${DMG_ARTIFACTS[@]}" "${CHECKSUM_ARTIFACTS[@]}" \
    --title "${TITLE}" \
    --generate-notes
fi

echo "Published GitHub release ${TAG}."