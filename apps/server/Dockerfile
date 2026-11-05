# The share server in a container: the static Go executable and nothing else, with its records
# (SQLite) and files in /data. Build it from this folder, for this machine or another:
#
#   docker build -t open-arch-share apps/server
#   docker build --platform linux/arm64 -t open-arch-share apps/server
#   docker run -d -p 8787:8787 -v open-arch-share:/data open-arch-share
#
# Settings are environment variables (open-arch-share help lists them). The README's "The share
# server" section says how to run it behind a proxy with HTTPS, and take down abuse.
#
# A release (.github/workflows/release.yml) puts in the executables CI built and tested, in place
# of the build stage: --build-context build=<folder>, with out/open-arch-share and out/data/ in it.

# Go runs on the machine building the image, and builds for the one it's for, so building for
# another architecture needs no emulator.
FROM --platform=$BUILDPLATFORM golang:1.27.3 AS build
ARG TARGETOS TARGETARCH
# The version it says it is: package.json's, unless a build names one.
ARG VERSION
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# No C at all (the SQLite is pure Go), so the executable needs nothing from the image it runs in.
RUN version="${VERSION:-$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json)}" \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X main.version=$version" -o /out/open-arch-share . \
    && mkdir /out/data

# Nothing but the executable: no shell, no package manager, nothing to patch.
FROM scratch
COPY --from=build /out/open-arch-share /usr/local/bin/open-arch-share
COPY --from=build --chown=65532:65532 /out/data /data
LABEL org.opencontainers.image.title="open-arch share server" \
      org.opencontainers.image.description="Keeps workspaces shared from the open-arch designer, end-to-end encrypted."
ENV PATH=/usr/local/bin \
    PORT=8787 \
    DATA_DIR=/data
# An unprivileged user, which owns /data.
USER 65532:65532
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["open-arch-share", "health"]
ENTRYPOINT ["open-arch-share"]
CMD ["serve"]
