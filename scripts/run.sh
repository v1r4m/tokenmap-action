#!/bin/bash
# Daily entrypoint: rescan local transcripts, re-render, and push if anything moved.
# Invoked by launchd (see launchd/com.viram.tokenmap.plist) or run by hand.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# launchd runs with a minimal PATH that has neither Homebrew node nor git.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

command -v node >/dev/null || { log "node not found on PATH"; exit 1; }
command -v git  >/dev/null || { log "git not found on PATH";  exit 1; }

log "sync"
node scripts/sync.mjs

log "render"
node scripts/render.mjs

if git diff --quiet -- data assets README.md; then
  log "no change — nothing to commit"
  exit 0
fi

git add data assets README.md
git commit -q -m "chore: update usage heatmap ($(date '+%Y-%m-%d'))"
log "committed"

if git remote get-url origin >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if git push -q origin "$branch"; then
    log "pushed to origin/$branch"
  else
    log "push failed — commit is local only"
    exit 1
  fi
else
  log "no origin remote — commit is local only"
fi
