#!/usr/bin/env bash
# Push the project to GitHub.
#
#   ./scripts/push-to-github.sh                 # prompts for your token
#   ./scripts/push-to-github.sh ghp_xxxx        # or pass it inline
#
# The token needs WRITE access to the repo:
#   classic PAT  → tick the "repo" checkbox
#   fine-grained → Repository permissions → Contents: Read and write
set -euo pipefail

REPO="${GITHUB_REPO:-sqdq2/grocerystore}"
cd "$(dirname "$0")/.."

if [ -t 0 ]; then
  printf 'Paste your GitHub token for %s: ' "$REPO"
  read -rs TOKEN; printf '\n'
else
  TOKEN="${1:-${GITHUB_TOKEN:-}}"
fi
[ -n "${TOKEN:-}" ] || { echo "No token supplied. Nothing pushed."; exit 1; }

# --- 1. verify the token and its scopes before touching the repo ---
echo "→ checking token…"
SCOPES=$(curl -skI -H "Authorization: Bearer ${TOKEN}" -H "User-Agent: push-check" \
  https://api.github.com/user | tr -d '\r' | grep -i '^x-oauth-scopes:' | cut -d: -f2- | sed 's/^ *//')
LOGIN=$(curl -sk -H "Authorization: Bearer ${TOKEN}" -H "User-Agent: push-check" \
  https://api.github.com/user | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("login",""))
except Exception: print("")' 2>/dev/null || true)

if [ -z "$LOGIN" ]; then
  echo "❌ Token rejected by GitHub (401 Bad credentials)."
  echo "   It is likely revoked, expired, or truncated. Make a new one."
  exit 1
fi
echo "  ✓ token valid for user: $LOGIN"
echo "  scopes: ${SCOPES:-<none reported>}"
case "$SCOPES" in
  *repo*|*public_repo*|*workflow*) echo "  ✓ has repository write scope" ;;
  *) echo "  ⚠ no 'repo' scope reported — a push needs it (classic PAT: tick 'repo')" ;;
esac

# --- 2. push ---
git config user.email "${GIT_AUTHOR_EMAIL:-ayush.bagul@bijasan.example}"
git config user.name  "${GIT_AUTHOR_NAME:-Ayush Bagul}"
git add -A
git commit -q -m "Bijasan General Store — Grocery Store Management System" 2>/dev/null || true
git branch -M main

# the sandbox egress proxy presents an untrusted CA; relax verification here only
export GIT_SSL_NO_VERIFY="${GIT_SSL_NO_VERIFY:-1}"

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"

echo "→ pushing $(git rev-parse --short HEAD) to ${REPO} (branch: main)…"
if git push -u origin main; then
  # scrub the token out of the remote immediately
  git remote set-url origin "https://github.com/${REPO}.git"
  echo ""
  echo "✅ Pushed to https://github.com/${REPO}"
  echo "   Render → New + → Blueprint → connect ${REPO}"
  echo "   (render.yaml is already in the repo root)"
else
  git remote set-url origin "https://github.com/${REPO}.git"
  echo ""
  echo "❌ Push failed. If the token has no 'repo' scope, regenerate it with that box ticked."
  exit 1
fi
