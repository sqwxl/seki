FROM rust:1.84-bookworm AS builder

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY go-engine/Cargo.toml go-engine/Cargo.toml
COPY seki-web/Cargo.toml seki-web/Cargo.toml

# Create dummy sources so cargo can resolve deps
RUN mkdir -p go-engine/src seki-web/src \
    && echo "fn main() {}" > go-engine/src/lib.rs \
    && echo "fn main() {}" > seki-web/src/main.rs

RUN cargo build --release -p seki-web

# Now copy real sources and rebuild
RUN rm -rf go-engine/src seki-web/src
COPY go-engine/src go-engine/src
COPY seki-web/src seki-web/src
COPY seki-web/migrations seki-web/migrations

# Touch main.rs so cargo detects the change
RUN touch seki-web/src/main.rs && cargo build --release -p seki-web

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/seki-web /usr/local/bin/seki-web
COPY seki-web/static /app/static

WORKDIR /app
EXPOSE 3000

CMD ["seki-web"]
