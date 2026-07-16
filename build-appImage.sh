#!/usr/bin/env bash
# Builds the Linux x64 AppImage into release/.
#
# Steps:
#   1. Stamp the git commit count into the version (e.g. 4.6.1+9182)
#   2. Production webpack build + packaging via electron-forge
#   3. Wrap the packaged app into an AppImage via electron-builder
#
# Result: release/Zettlr-<version>-x86_64.AppImage

set -euo pipefail
cd "$(dirname "$0")"

# The yarn 4 corepack shim lives here on this machine
export PATH="$HOME/.local/bin:$PATH"

yarn version:build
yarn package:linux-x64
yarn electron-builder --linux AppImage --x64 --publish never --prepackaged out/Zettlr-linux-x64

ls -lh release/
