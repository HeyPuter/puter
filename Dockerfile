# /!\ NOTICE /!\

# Many of the developers DO NOT USE the Dockerfile or image.
# While we do test new changes to Docker configuration, it's
# possible that future changes to the repo might break it.
# When changing this file, please try to make it as resiliant
# to such changes as possible; developers shouldn't need to
# worry about Docker unless the build/run process changes.

# Build stage
FROM node:22-alpine AS build

# Install build dependencies
RUN apk add --no-cache git python3 make g++ \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Set up working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Copy the source files
COPY . .

# Install mocha
RUN npm install -g mocha

# Install node modules
RUN npm cache clean --force && \
    for i in 1 2 3; do \
        npm ci --registry=https://registry.npmjs.org/ && break || \
        if [ $i -lt 3 ]; then \
            sleep 15; \
        else \
            exit 1; \
        fi; \
    done

# Run the build command if necessary
RUN cd src/gui && npm run build && cd -

# Production stage
FROM node:22-alpine

# Set labels
LABEL repo="https://github.com/HeyPuter/puter"
LABEL license="AGPL-3.0,https://github.com/HeyPuter/puter/blob/master/LICENSE.txt"
LABEL version="1.2.46-beta-1"

# Install git (required by Puter to check version)
RUN apk add --no-cache git

# Set up working directory
RUN mkdir -p /opt/puter/app
WORKDIR /opt/puter/app

# Copy built artifacts and necessary files from the build stage
COPY --from=build /app/src/gui/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY . .

# Set permissions
RUN chown -R node:node /opt/puter/app
USER node

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://puter.localhost:4100/test || exit 1

ENV NO_VAR_RUNTUME=1

CMD ["npm", "start"]
