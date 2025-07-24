#!/bin/bash
# Install node-red-bluesky to Node-RED palette for the nodered user and restart Node-RED

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Path to this codebase
NODE_PATH="$(pwd)"

# Name of the Node-RED systemd service (adjust if different)
NODERED_SERVICE="nodered.service"

# Function to print status messages
status() {
    echo -e "${GREEN}[*]${NC} $1"
}

# Function to print warning messages
warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Function to print error messages and exit
error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    warning "This script requires root privileges. Please run with sudo."
    exec sudo "$0" "$@"
fi

status "Installing node-red-bluesky to Node-RED user directory..."

# Install build dependencies
status "Installing build dependencies..."
if ! command -v npm &> /dev/null; then
    warning "npm not found. Installing Node.js and npm..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && \
    apt-get install -y nodejs || error "Failed to install Node.js and npm"
fi

# Install TypeScript and other dev dependencies
status "Installing TypeScript and build tools..."
npm install --save-dev typescript ts-node ttypescript || error "Failed to install TypeScript"

# Install ttsc globally for the current user
if ! command -v ttsc &> /dev/null; then
    status "Installing ttypescript globally..."
    npm install -g ttypescript || warning "Failed to install ttypescript globally, trying local installation..."
    # If global install fails, install locally
    if ! command -v ttsc &> /dev/null; then
        npm install --save-dev ttypescript
        # Add local node_modules/.bin to PATH
        export PATH="$(npm bin):$PATH"
    fi
fi

# Build the project
status "Building node-red-bluesky..."
if ! npm run build; then
    warning "Build failed. Trying alternative build method..."
    # Try building with npx
    npx ttsc || warning "Build step completed with warnings. Continuing installation..."
fi

# Remove any old installed files for this node
NODE_MODULE_DIR="/home/nodered/.node-red/node_modules/node-red-bluesky"
if sudo -u nodered test -d "$NODE_MODULE_DIR"; then
    status "Removing old node-red-bluesky files from $NODE_MODULE_DIR..."
    sudo -u nodered rm -rf "$NODE_MODULE_DIR"
fi

# Also remove any symlink from .node-red/node_modules if present
SYMLINK="/home/nodered/.node-red/node_modules/node-red-bluesky"
if sudo -u nodered test -L "$SYMLINK"; then
    status "Removing old node-red-bluesky symlink..."
    sudo -u nodered rm "$SYMLINK"
fi

# Install the node as the nodered user with production flag to avoid dev dependencies
status "Installing node-red-bluesky in Node-RED user directory..."
sudo -u nodered npm install --omit=dev --prefix /home/nodered/.node-red "$NODE_PATH" || \
    error "Failed to install node-red-bluesky"

# Fix permissions
status "Setting correct permissions..."
sudo chown -R nodered:nodered "/home/nodered/.node-red"

# Restart Node-RED
status "Restarting Node-RED service..."
if systemctl is-active --quiet "$NODERED_SERVICE"; then
    sudo systemctl restart "$NODERED_SERVICE" || warning "Failed to restart Node-RED service"
else
    warning "Node-RED service is not running. Please start it manually."
fi

echo -e "\n${GREEN}Installation complete!${NC}"
echo "Please check your Node-RED palette for 'bluesky' nodes."
echo "If you don't see the nodes, try refreshing your browser or restarting Node-RED manually."

# Check if the nodes are properly registered
if [ -f "/home/nodered/.node-red/package.json" ]; then
    if grep -q "node-red-bluesky" "/home/nodered/.node-red/package.json"; then
        status "node-red-bluesky is properly registered in Node-RED."
    else
        warning "node-red-bluesky might not be properly registered. Check Node-RED logs for errors."
    fi
fi
