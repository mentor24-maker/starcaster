# yt-dlp + ffmpeg + Node. Debian rather than Alpine because ffmpeg's mp3
# encoder and yt-dlp's Python runtime are both far less fussy here.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       python3 \
       ca-certificates \
       curl \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp from its own release rather than apt: YouTube changes its
# player often, and the distro package is usually months behind and broken.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=8080
EXPOSE 8080

# Downloads land in the container's temp dir and are deleted after upload, so
# no volume is needed — but the container does need real disk headroom.
CMD ["node", "server.js"]
