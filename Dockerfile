FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Persistent creds live on a Fly volume mounted at /data so they
# survive deploys + restarts.
ENV CREDS_DIR=/data

CMD ["node", "server.js"]
