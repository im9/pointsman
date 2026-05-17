#!/usr/bin/env bash
# Verify the build produced every expected plug-in format.
#
# Pointsman ships AU + VST3 + CLAP (no Standalone — MIDI fx target only).
# Exits non-zero on the first missing artefact set, listing all missing
# paths.
#
# Usage: ./scripts/check-artefacts.sh [BUILD_DIR] [CONFIG]
# Defaults: BUILD_DIR=build CONFIG=Release

set -eu

BUILD_DIR="${1:-build}"
CONFIG="${2:-Release}"
ARTEFACT_ROOT="${BUILD_DIR}/Pointsman_artefacts/${CONFIG}"

EXPECTED=(
    "${ARTEFACT_ROOT}/VST3/Pointsman.vst3"
    "${ARTEFACT_ROOT}/AU/Pointsman.component"
    "${ARTEFACT_ROOT}/CLAP/Pointsman.clap"
)

missing=0
for path in "${EXPECTED[@]}"; do
    if [ -e "$path" ]; then
        printf 'ok       %s\n' "$path"
    else
        printf 'MISSING  %s\n' "$path"
        missing=$((missing + 1))
    fi
done

if [ "$missing" -gt 0 ]; then
    printf '\n%d artefact(s) missing under %s\n' "$missing" "$ARTEFACT_ROOT" >&2
    exit 1
fi
