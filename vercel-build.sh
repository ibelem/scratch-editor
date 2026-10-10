#!/bin/sh
set -e
cd "$(git rev-parse --show-toplevel)"
export NODE_ENV=production
npm run build -w packages/scratch-storage -w packages/scratch-svg-renderer -w packages/scratch-render -w packages/scratch-vm -w packages/scratch-paint
npm run build:dev -w packages/scratch-gui
