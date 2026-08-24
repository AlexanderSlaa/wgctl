# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-alpine
RUN apk add --no-cache wireguard-tools iproute2 iptables tini

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh dist/main.js && \
    ln -s /app/dist/main.js /usr/local/bin/wgctl

# We run as root deliberately: wg-quick, iptables, and sysctl all need
# CAP_NET_ADMIN/CAP_NET_RAW, and wgctl's own root check (src/elevate.ts)
# assumes uid 0 with no sudo binary available in this image.
ENV WGCTL_NO_SUDO=1 \
    WG_INTERFACE=wg0 \
    WG_LISTEN_PORT=51820 \
    WG_SUBNET=10.88.0.0/24
# WG_CONF_PATH / DB_PATH are derived from WG_INTERFACE at container start
# (see docker-entrypoint.sh) unless set explicitly.

VOLUME ["/etc/wireguard", "/etc/wgctl"]

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["hub"]
