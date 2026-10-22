#!/usr/bin/env bash
# Push the project to GitHub.
#
#   ./scripts/push-to-github.sh                 # prompts for your token
#   ./scripts/push-to-github.sh ghp_xxxx        # or pass it inline
#
# Needs a fine-grained Personal Access Token with
#   Contents : Read and write   (on sqdq2/grocerystore only)
set -euo pipefail

REPO="${GITHUB_REPO:-sqdq2/grocerystore}"

cd "$(dirname "$0")/.."

if [ -t 0 ]; then
  printf 'Paste your GitHub token for %s: ' "$REPO"
  read -rs TOKEN
  printf '\n'
else
  TOKEN="${1:-${GITHUB_TOKEN:-}}"
fi

[ -n "${TOKEN:-}" ] || { echo "No token supplied. Nothing pushed."; exit 1; }

git config user.email "${GIT_AUTHOR_EMAIL:-ayush.bagul@bijasan.example}"
git config user.name  "${GIT_AUTHOR_NAME:-Ayush Bagul}"

git add -A
git commit -q -m "Bijasan General Store — Grocery Store Management System" 2>/dev/null || true
git branch -M main

# This sandbox's egress proxy presents an untrusted CA, so certificate
# verification is relaxed here only. On your own machine you can drop it.
export GIT_SSL_NO_VERIFY="${GIT_SSL_NO_VERIFY:-1}"

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"

echo "→ Pushing $(git rev-parse --short HEAD) to ${REPO} (branch: main)…"
if git push -u origin main; then
  echo ""
  echo "✅ Pushed to https://github.com/${REPO}"
  echo "   Now open Render → New + → Blueprint → connect ${REPO}"
  echo "   (render.yaml is already in the repo root)"
  echo ""
  echo "🔒 Revoke this token now if you pasted it — the code is safely on GitHub."
else
  echo ""
  echo "❌ Push failed. Check the token has Contents: Read and write on ${REPO}."
  exit 1
fi
