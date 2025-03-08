# /!\ NOTICE /!\
# Many developers do not use this Dockerfile or its image.
# While we test Docker configuration changes, future repository updates
# may break it. When modifying this file, aim for resilience against
# such changes. Developers should only need to address Docker if the
# build/run process itself changes.

# --- Build Stage ---
FROM node:22-alpine AS build

# Install build dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
  && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

# Copy dependency manifests first (optimization for caching)
COPY package.json package-lock.json ./

# Install global testing tool
RUN npm install -g mocha

# Install project dependencies with retry logic
RUN npm cache clean --force \
  && for attempt in 1 2 3; do \
       npm ci && break || \
       if [ "$attempt" -lt 3 ]; then \
         echo "Install failed, retrying in 15s..." && sleep 15; \
       else \
         echo "Failed to install dependencies after 3 attempts" && exit 1; \
       fi; \
     done

# Copy remaining source files
COPY . .

# Build the GUI (if required)
RUN cd src/gui && npm run build && cd -

# --- Production Stage ---
FROM node:22-alpine

# Metadata labels
LABEL repo="https://github.com/HeyPuter/puter" \
      license="AGPL-3.0,https://github.com/HeyPuter/puter/blob/master/LICENSE.txt" \
      version="1.2.46-beta-1"

# Install runtime dependencies
RUN apk add --no-cache git

# Set up application directory
WORKDIR /opt/puter/app
RUN mkdir -p /opt/puter/app

# Copy artifacts from build stage
COPY --from=build /app/src/gui/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app ./

# Set ownership for security
RUN chown -R node:node /opt/puter/app
USER node

# Expose application port
EXPOSE 4100

# Healthcheck for container monitoring
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://puter.localhost:4100/test || exit 1

# Environment variables
ENV NO_VAR_RUNTIME=1

# Workaround for potential `lru-cache@11.0.2` issue
RUN npm install

# Start the application
CMD ["npm", "start"]
