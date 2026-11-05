# The share server in a container: Node, with records in SQLite and files on disk, in /data.
# Build it from the repository's root, which the build needs for pnpm's workspace:
#
#   docker build -f apps/server/Dockerfile -t open-arch-share .
#   docker run -d -p 8787:8787 -v open-arch-share:/data open-arch-share
#
# Settings are environment variables (node dist/main.js help lists them). The README's "The
# share server" section says how to run it behind a proxy with HTTPS, and take down abuse.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Only the server's own build tools: it has no runtime dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @open-arch/server --ignore-scripts
COPY apps/server apps/server
RUN pnpm --filter @open-arch/server build

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /repo/apps/server/package.json ./
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/migrations ./migrations
# open-arch-share runs the server's commands: `docker exec <container> open-arch-share block <id> --reason <why>`.
RUN printf '#!/bin/sh\nexec node /app/dist/main.js "$@"\n' > /usr/local/bin/open-arch-share \
    && chmod +x /usr/local/bin/open-arch-share \
    && mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["open-arch-share"]
CMD ["serve"]
