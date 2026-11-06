# AGMX PocketBase — Fly.io image
# Follows the official pattern (https://pocketbase.io/docs/going-to-production/#using-docker).
# PocketBase has no official Docker image, so we fetch the release binary.

FROM alpine:latest

# Must match the supported version — see pocketbase/README.md.
# tools/check.sh pass 10 enforces the 0.40 JSVM API on the hooks below.
ARG PB_VERSION=0.40.4

RUN apk add --no-cache \
    unzip \
    ca-certificates

# Download and unzip PocketBase (binary lands at /pb/pocketbase).
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

# Route registrations + server-side money-flow logic.
COPY ./pb_hooks /pb/pb_hooks

# NOTE: pb_migrations/ is intentionally NOT copied. It is a local artifact
# (gitignored) whose files sort alphabetically within identical timestamps,
# so relation targets are not yet created when a dependent migration runs.
# Production schema is bootstrapped via tools/pb_migrate.py, which
# topologically sorts pocketbase/collections.json — see pocketbase/README.md.

EXPOSE 8090

# --dir must match the fly.toml mount target so data persists across restarts.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data"]
