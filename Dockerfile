FROM node:21-alpine

# Set labels
LABEL repo="https://github.com/HeyPuter/puter"
LABEL license="AGPL-3.0,https://github.com/HeyPuter/puter/blob/master/LICENSE.txt"
LABEL version="v1.2.40-beta"

# Debugging
RUN apk add --no-cache bash # useful for debugging

# Setup working directory
RUN mkdir -p /opt/puter/app
WORKDIR /opt/puter/app

# Add source files
# NOTE: This might change (https://github.com/HeyPuter/puter/discussions/32)
COPY . .

# Set permissions
RUN chown -R node:node /opt/puter/app
USER node

# Install node modules
RUN npm cache clean --force \
    && npm install

EXPOSE 4000


CMD [ "npm", "start" ]
