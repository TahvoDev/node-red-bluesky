#!/bin/bash
# Install node-red-bluesky to Node-RED palette for the nodered user and restart Node-RED

set -e

# Path to this codebase
NODE_PATH="$(pwd)"

# Name of the Node-RED systemd service (adjust if different)
NODERED_SERVICE="nodered.service"

echo "Installing node-red-bluesky to Node-RED user directory..."

# Remove any old installed files for this node
NODE_MODULE_DIR="/home/nodered/.node-red/node_modules/node-red-bluesky"
if sudo -u nodered test -d "$NODE_MODULE_DIR"; then
  echo "Removing old node-red-bluesky files from $NODE_MODULE_DIR..."
  sudo -u nodered rm -rf "$NODE_MODULE_DIR"
fi

# Also remove any symlink from .node-red/node_modules if present
SYMLINK="/home/nodered/.node-red/node_modules/node-red-bluesky"
if sudo -u nodered test -L "$SYMLINK"; then
  echo "Removing old node-red-bluesky symlink..."
  sudo -u nodered rm "$SYMLINK"
fi

# Install the node as the nodered user
sudo -u nodered npm install --prefix /home/nodered/.node-red "$NODE_PATH"

echo "Restarting Node-RED service..."
sudo systemctl restart "$NODERED_SERVICE"

echo "Installation complete. Check Node-RED palette for 'node-red-bluesky'."
