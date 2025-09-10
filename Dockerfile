# /!\ NOTICE /!\
# Many of the developers DO NOT USE the Dockerfile or image.
# While we do test new changes to Docker configuration, it's
# possible that future changes to the repo might break it.
# When changing this file, please try to make it as resiliant
# to such changes as possible; developers shouldn't need to
# worry about Docker unless the build/run process changes.

# Build stage
FROM node:23.9-alpine AS build

# Set environment variables to reduce npm verbosity and improve performance
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=error \
    NPM_CONFIG_PROGRESS=false

# Install build dependencies
RUN apk add --no-cache git python3 make g++ \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Set up working directory
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./
# Copy workspace package.json files (for workspaces like gui)
COPY src/gui/package*.json ./src/gui/

# Install mocha globally
RUN npm install -g mocha

# Try to install dependencies with better error handling and retries
RUN npm cache clean --force && \
    for i in 1 2 3; do \
        echo "Attempt $i: Installing dependencies..." && \
        npm ci && break || \
        if [ $i -lt 3 ]; then \
            echo "Retrying in 15 seconds..." && \
            sleep 15; \
        else \
            echo "Failed to install dependencies after 3 attempts" && \
            exit 1; \
        fi; \
    done

# Ensure html-entities is installed (addressing specific dependency issue)
RUN npm install html-entities

# Copy source files after dependency installation
COPY . .

# Install GUI dependencies if needed and build
RUN cd src/gui && npm ci && npm run build

# Production stage
FROM node:23.9-alpine

# Set environment variables
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=error \
    NO_VAR_RUNTUME=1

# Set labels
LABEL repo="https://github.com/HeyPuter/puter" \
      license="AGPL-3.0,https://github.com/HeyPuter/puter/blob/master/LICENSE.txt" \
      version="1.2.46-beta-1" \
      maintainer="Puter Team"

# Install git (required by Puter to check version)
RUN apk add --no-cache git curl

# Create directory structure and set permissions before copying files
RUN mkdir -p /opt/puter/app && \
    chown -R node:node /opt/puter

# Set up working directory
WORKDIR /opt/puter/app

# Copy only necessary files from the build stage
COPY --from=build --chown=node:node /app/src/gui/dist ./src/gui/dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/LICENSE.txt ./

# Switch to non-root user
USER node

# Expose the service port
EXPOSE 4100

# Improved healthcheck that uses curl (more reliable than wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://puter.localhost:4100/test || exit 1

# Start the application
CMD ["node", "src/index.js"]
