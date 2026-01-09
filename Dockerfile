FROM node:22-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache \
    python3 \
    sqlite \
    sqlite-dev \
    make \
    g++

COPY package.json .

RUN npm install --legacy-peer-deps

COPY . .

ARG OPENID_CLIENT_ID
ARG OPENID_CLIENT_SECRET
ARG OPENID_DISCOVERY_URL
ARG PANEL_API_URL
ARG PANEL_TYPE
ARG BETTER_AUTH_SECRET

ENV OPENID_CLIENT_ID=$OPENID_CLIENT_ID \
  OPENID_CLIENT_SECRET=$OPENID_CLIENT_SECRET \
  OPENID_DISCOVERY_URL=$OPENID_DISCOVERY_URL \
  PANEL_API_URL=$PANEL_API_URL \
  PANEL_TYPE=$PANEL_TYPE \
  BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET

EXPOSE 3000

CMD ["npm", "run", "start:docker"]
