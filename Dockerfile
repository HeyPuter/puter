FROM node:hydrogen-alpine
WORKDIR /app
COPY . .
RUN yarn install
CMD ["node", "dev-server.js"]
EXPOSE 4000
