#!/bin/bash

sudo cp -r bandit-controller/packages/node-v22.14.0-linux-x64/{bin,include,lib,share} /usr/

sudo cp /home/pal/bandit-movement-controller/bandit-controller/packages/pnpm-linux-x64 /usr/local/bin/pnpm
sudo chmod +x /usr/local/bin/pnpm

# Install pnpm
sudo npm install -g pnpm

# Navigate to frontend directory and install dependencies
cd bandit-controller/frontend
sudo pnpm install

# Build and start the frontend
cd ..
sudo pnpm run build-start &

cd ../bandit-movement-controller/

catkin_make

source ./devel/setup.bash
roslaunch movement start.launch