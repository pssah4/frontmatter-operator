#!/bin/bash

# Deploy Frontmatter Editor to your local Obsidian vault.
# Usage: ./deploy-local.sh
#
# Requires a .env file in the project root with:
#   PLUGIN_DIR=/path/to/your/obsidian/vault/.obsidian/plugins/frontmatter-editor

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

if [ -z "$PLUGIN_DIR" ]; then
  echo "Error: PLUGIN_DIR not set. Create a .env file with:"
  echo "  PLUGIN_DIR=/path/to/.obsidian/plugins/frontmatter-editor"
  exit 1
fi

echo "Deploying Frontmatter Editor to: $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR"

cp manifest.json "$PLUGIN_DIR/"
cp main.js "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"

echo "Done. Reload Obsidian (or use the 'Reload app without saving' command)."
