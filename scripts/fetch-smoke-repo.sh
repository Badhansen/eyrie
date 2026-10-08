#!/usr/bin/env bash
# Clones a real open-source Next.js app that Eyrie can be smoke-tested against.
#
# The clone is deliberately NOT vendored into this repository: it stays in the
# gitignored .smoke/ directory so we carry no third-party code and no license
# obligations. fixtures/ remains the hand-written assertion fixture; this is the
# "does it survive real code" target.
#
# Repo: accretence/next-prisma-tailwind-ecommerce (MIT) — a Next.js App Router
# storefront + admin monorepo with middleware.ts and Prisma, ~275 ts/tsx files.
set -euo pipefail

REPO_URL="https://github.com/accretence/next-prisma-tailwind-ecommerce.git"
REPO_REF="${SMOKE_REPO_REF:-main}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/.smoke/next-prisma-tailwind-ecommerce"

if [ -d "$DEST/.git" ]; then
  echo "Smoke repo already present at $DEST"
  echo "Delete .smoke/ to re-fetch."
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
echo "Cloning $REPO_URL ($REPO_REF) into $DEST ..."
git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$DEST"

echo
echo "Done. Its LICENSE (MIT) is at $DEST/LICENSE."
echo "Run the smoke test with: pnpm smoke"
