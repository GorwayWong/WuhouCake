ARG POSTGRES_IMAGE=postgres:17-bookworm
FROM ${POSTGRES_IMAGE}
ARG PGBACKREST_VERSION=2.60.0-1.pgdg12+1
RUN apt-get update \
    && apt-get install -y --no-install-recommends "pgbackrest=${PGBACKREST_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
