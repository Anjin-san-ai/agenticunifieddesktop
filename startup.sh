#!/bin/bash

# Azure App Service startup script for Linux
# This script runs when the container starts

echo "Starting Athena Cognitive Desktop..."

# Install dependencies (Azure caches node_modules, but this ensures freshness)
npm install --production

# Start the application
npm start
