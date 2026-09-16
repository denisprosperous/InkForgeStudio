#!/usr/bin/env sh
# fetch-assets.sh — download optional runtime assets for EPUB validation.
#
# EPUBCheck is the conformance gate the export pipeline reports against
# (packages/core/src/validate/epubcheck.ts). Java is expected on PATH; this
# script only fetches the jar + libs into the location the validator scans by
# default (docker/epubcheck-<version>/epubcheck.jar).
set -eu

VERSION="5.2.1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEST="$ROOT/docker/epubcheck-$VERSION"

if [ -f "$DEST/epubcheck.jar" ]; then
  echo "fetch-assets: EPUBCheck $VERSION already present at $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "fetch-assets: downloading EPUBCheck $VERSION..."
curl -fL "https://github.com/w3c/epubcheck/releases/download/v$VERSION/epubcheck-$VERSION.zip" \
  -o "$TMP/epubcheck.zip"
unzip -q "$TMP/epubcheck.zip" -d "$TMP"

mkdir -p "$DEST"
cp "$TMP/epubcheck-$VERSION/epubcheck.jar" "$DEST/epubcheck.jar"
cp -R "$TMP/epubcheck-$VERSION/lib" "$DEST/lib"

echo "fetch-assets: installed $DEST/epubcheck.jar (set EPUBCHECK_JAR to override)"
