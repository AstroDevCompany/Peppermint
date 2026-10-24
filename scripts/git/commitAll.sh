#!/usr/bin/env bash
# Script by Luca Montanari

# Lock execution to dev/project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
cd "$PROJECT_ROOT" || exit 1

echo "Pulling..."
git pull || exit 1

echo "Adding all files..."
git add .

# Check if there are staged changes ready for commit
if git diff --cached --quiet; then
  echo "Nothing to commit, working tree clean."
  exit 0
fi

# Prompt for message only if there is actually something to commit
read -r -p "Enter commit message: " msg

# Check if the user entered an empty message
if [ -z "$msg" ]; then
  echo "Commit message cannot be empty. Aborting."
  exit 1
fi

echo "Committing with message: ${msg}..."
git commit -m "$msg"

echo "Pushing..."
git push
