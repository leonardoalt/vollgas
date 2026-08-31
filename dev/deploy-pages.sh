#!/usr/bin/env bash
# Build the site and publish it to the gh-pages branch.
#
# The built site is not tracked on main (dist/ is gitignored), so it is pushed
# as an orphan history on gh-pages instead. Re-run this after any change:
#   npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="$(git remote get-url origin)"
NAME="$(git config user.name || echo 'deploy')"
EMAIL="$(git config user.email || echo 'deploy@localhost')"

npm run build
# the Pages site is the playable game; the single-file artifact copy is not needed
rm -f dist/artifact.html

cd dist
rm -rf .git
touch .nojekyll                      # Pages must not run Jekyll over this
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="$NAME" -c user.email="$EMAIL" \
    commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "gh-pages updated"
