#!/usr/bin/env bash
# Puts the source of the commit being built, and the license text, beside the built page. The app links to both
# (app/common/LegalNotice): AGPL-3.0 §13 has every user of the hosted app offered the source of the running version.
# deploy.sh builds only a clean, pushed HEAD, so the archive of HEAD is the deployed source.
set -euo pipefail
cd "$(dirname "$0")/.."
git archive --format=tar.gz --prefix="risu-alpha-$(git rev-parse --short HEAD)/" -o dist/client/source.tar.gz HEAD
cp LICENSE dist/client/license.txt
