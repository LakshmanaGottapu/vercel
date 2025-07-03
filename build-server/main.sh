#!/bin/bash
mkdir -p /app/output
git clone $GITHUB_REPO_URL /app/output
exec npm start

