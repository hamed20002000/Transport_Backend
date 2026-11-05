# Transport backend (NestJS). Built and run by deploy/docker-compose.yml.
# NPM_REGISTRY, DEBIAN_MIRROR: mirrors when npm or Debian are out of reach from the server
# (e.g. DEBIAN_MIRROR=https://mirror.arvancloud.ir).
FROM node:20.20.2-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG DEBIAN_MIRROR=http://deb.debian.org
WORKDIR /app
# native modules (bcrypt, sharp, …) that have no prebuilt binary are compiled here
RUN sed -i "s#http://deb.debian.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true update && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# IPv4 first (IPv6 hangs on networks without it), patient retries, and a cache that survives a failed build
RUN --mount=type=cache,target=/root/.npm NODE_OPTIONS=--dns-result-order=ipv4first npm ci --registry="$NPM_REGISTRY" \
    --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=600000
COPY . .
RUN npx nest build

# Piper (offline text to speech) and its Persian voice: the stations read out on the driver panel and the
# load announcements sent as voice. Pinned versions, checked by sha256.
FROM debian:bookworm-slim AS piper
ARG DEBIAN_MIRROR=http://deb.debian.org
ARG PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
ARG VOICE_URL=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx
RUN sed -i "s#http://deb.debian.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true update && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN curl -4fsSL --retry 5 -o piper.tgz "$PIPER_URL" \
 && echo "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992  piper.tgz" | sha256sum -c - \
 && tar xzf piper.tgz && rm piper.tgz && mkdir piper/models \
 && curl -4fsSL --retry 5 -o piper/models/fa_IR-amir-medium.onnx "$VOICE_URL" \
 && curl -4fsSL --retry 5 -o piper/models/fa_IR-amir-medium.onnx.json "$VOICE_URL.json" \
 && printf '%s  %s\n' \
      fb815380d969ea372b0b21b0de14421f58fe481047e153e69685d079b6e1a9d1 piper/models/fa_IR-amir-medium.onnx \
      75f918a3bf0f57a9179abe725af529f2a5c79d6c899e2a84aec76c685d5dfb9a piper/models/fa_IR-amir-medium.onnx.json \
    | sha256sum -c -

FROM node:20.20.2-bookworm-slim
ARG DEBIAN_MIRROR=http://deb.debian.org
# ffmpeg: voice messages and spoken replies
RUN sed -i "s#http://deb.debian.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true update && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true install -y --no-install-recommends ffmpeg ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Tehran PIPER_DIR=/opt/piper
COPY --from=piper /opt/piper /opt/piper
WORKDIR /app
# all dependencies stay (dev ones too): migrations run with ts-node (npm run typeorm -- migration:run)
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# read at run time from src/: the agent's JSON files and prompts, the Excel template; and the migrations
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node package.json tsconfig.json tsconfig.build.json ./
# .env, keys/, cdn/ (files the panel serves) and the upload folders come from the machine (volumes), never from the image
# files are copied in as node already: chown -R over node_modules took ~20 minutes and doubled that layer
RUN mkdir -p uploads private-uploads keys logs cdn && chown node:node /app uploads private-uploads keys logs cdn
USER node
EXPOSE 3006
CMD ["node", "dist/main"]
