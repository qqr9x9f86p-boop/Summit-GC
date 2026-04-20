#!/bin/bash
# Auto-commit and push changes in the SUMMIT GC DEMO folder to GitHub
# Run this in a VS Code terminal tab — it will watch for changes and push automatically.

REPO_DIR="/Users/imso2200/Desktop/SUMMIT GC DEMO"

cd "$REPO_DIR" || exit 1

echo "👀  Watching for changes in SUMMIT GC DEMO... (Ctrl+C to stop)"

while true; do
  sleep 30

  # Check if there are any uncommitted changes
  if [ -n "$(git status --short)" ]; then
    TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$TIMESTAMP] Changes detected — committing and pushing..."
    git add -A
    git commit -m "Auto-save: $TIMESTAMP"
    git push origin main
    echo "[$TIMESTAMP] ✅ Pushed to GitHub!"
  fi
done
