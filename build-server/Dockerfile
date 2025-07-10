# Use Ubuntu 20.04 (Focal Fossa) as the base image
FROM ubuntu:focal

# Update system packages and install dependencies
RUN apt-get update && \
    apt-get install -y ca-certificates curl gnupg wget && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y git nodejs && \
    npm install -g npm@latest && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g yarn && \
    yarn set version stable

# Verify installations
RUN node --version && \
    npm --version && \
    git --version && \
    yarn --version

# Set the working directory
WORKDIR /app
COPY package*.json .
RUN npm install
COPY index.js index.js
COPY main.sh main.sh

RUN chmod +x main.sh

# Default command (can be overridden)
ENTRYPOINT [ "/app/main.sh" ]
