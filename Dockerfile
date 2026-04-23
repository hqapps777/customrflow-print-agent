# syntax=docker/dockerfile:1.7

###############
# Stage 1: build — compile TypeScript to dist/
###############
FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY src ./src
ARG BUILD_TYPE=prod
ENV BUILD_TYPE=${BUILD_TYPE}
RUN npm run build

###############
# Stage 2: runtime — minimal image with production deps only
###############
FROM node:20-alpine AS runtime

# Dependencies needed at runtime:
# - cups-client: gives us `lp` for CUPS_IPP printing
# - avahi / libdbus: mDNS/Zeroconf resolution on the host network
# - tini: PID-1 signal-forwarding init so SIGTERM shuts down cleanly
RUN apk add --no-cache cups-client avahi-tools dbus tini

WORKDIR /app
COPY --from=builder /build/package.json /build/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /build/dist ./dist

# Persist config + keychain-fallback under /data (bind-mount in production)
ENV HOME=/data
RUN mkdir -p /data/.config/xflow-print-agent
VOLUME ["/data"]

# Default to the production backend URL — override only in dev/test builds.
ENV BUILD_TYPE=prod

# Fastify binds 127.0.0.1 by default (agent UI is host-local only).
# When the container is run with --network host, the UI is reachable at
# http://<docker-host>:38701 — see README.
EXPOSE 38701

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.title="Customrflow Print Agent"
LABEL org.opencontainers.image.description="Customrflow print agent — connects restaurant printers (ESC/POS, Star-Line, CUPS) to the Customrflow SaaS."
LABEL org.opencontainers.image.source="https://github.com/hqapps777/customrflow-print-agent"
LABEL org.opencontainers.image.licenses="MIT"
