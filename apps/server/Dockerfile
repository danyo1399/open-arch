# The share server in a container: the static Go executable and nothing else, with its records
# (SQLite) and files in /data. Build it from this folder:
#
#   docker build -t open-arch-share apps/server
#   docker run -d -p 8787:8787 -v open-arch-share:/data open-arch-share
#
# Settings are environment variables (open-arch-share help lists them). The README's "The share
# server" section says how to run it behind a proxy with HTTPS, and take down abuse.

FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# No C at all (the SQLite is pure Go), so the executable needs nothing from the image it runs in.
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json)" -o /open-arch-share . \
    && mkdir /data

# Nothing but the executable: no shell, no package manager, nothing to patch.
FROM scratch
COPY --from=build /open-arch-share /usr/local/bin/open-arch-share
COPY --from=build --chown=65532:65532 /data /data
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
