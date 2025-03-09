#!/bin/bash

# Define the remote server and destination path
REMOTE_USER="pal"
REMOTE_HOST="10.68.0.1"
REMOTE_PATH="/home/pal/bandit-movement-controller/bandit-controller"

# Copy all files in /workspaces/bandit-controller/, excluding node_modules and dist
rsync -av /workspaces/bandit-controller/ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
