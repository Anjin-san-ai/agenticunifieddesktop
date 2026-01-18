#!/bin/bash

# Azure App Service startup script for Linux
# This script runs when the container starts

set -e  # Exit on any error

echo "Starting Athena Cognitive Desktop..."
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "ERROR: package.json not found!"
    exit 1
fi

# Install dependencies (Azure caches node_modules, but this ensures freshness)
# Use --production to avoid installing devDependencies in production
echo "Installing dependencies..."
if ! npm install --production; then
    echo "ERROR: npm install failed!"
    exit 1
fi

# Verify node_modules exists
if [ ! -d "node_modules" ]; then
    echo "ERROR: node_modules directory not found after installation!"
    exit 1
fi

# Start the application
echo "Starting application..."
exec npm start
