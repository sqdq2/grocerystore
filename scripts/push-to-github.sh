#!/usr/bin/env bash
# Push the project to GitHub using a Personal Access Token.
#   ./scripts/push-to-github.sh ghp_xxxxxxxxxxxx
set -euo pipefail
TOKEN="${1:-${GITHUB_TOKEN:-}}"
REPO="${GITHUB_REPO:-sqdq2/grocerystore}"
[ -n "$TOKEN" ] || { echo "Usage: $0 <github-token>"; exit 1; }

cd "$(dirname "$0")/.."
git config user.email "${GIT_AUTHOR_EMAIL:-ayush.bagul@bijasan.example}"
git config user.name  "${GIT_AUTHOR_NAME:-Ayush Bagul}"
git add -A
git commit -q -m "Bijasan General Store — Grocery Store Management System" 2>/dev/null || true
git branch -M main

# the sandbox proxy presents an untrusted CA, so verification is disabled here only
export GIT_SSL_NO_VERIFY=1
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git push -u origin main
echo "✅ Pushed to https://github.com/${REPO}"
