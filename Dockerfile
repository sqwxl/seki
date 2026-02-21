FROM rust:1.93 AS deps

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY go-engine/Cargo.toml go-engine/Cargo.toml
COPY go-engine-wasm/Cargo.toml go-engine-wasm/Cargo.toml
COPY seki-web/Cargo.toml seki-web/Cargo.toml

# Create dummy sources so cargo can resolve deps
RUN mkdir -p go-engine/src go-engine-wasm/src seki-web/src \
    && echo "fn main() {}" > go-engine/src/lib.rs \
    && echo "fn main() {}" > go-engine-wasm/src/lib.rs \
    && echo "fn main() {}" > seki-web/src/main.rs

RUN cargo build --release -p seki-web

FROM deps AS builder

RUN rm -rf go-engine/src seki-web/src

COPY go-engine/src go-engine/src
COPY seki-web/src seki-web/src
COPY seki-web/templates seki-web/templates
COPY seki-web/migrations seki-web/migrations

RUN touch go-engine/src/lib.rs seki-web/src/main.rs && cargo build --release -p seki-web

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/seki-web /usr/local/bin/seki-web
COPY seki-web/static /app/static

RUN useradd -r -s /bin/false seki
USER seki
WORKDIR /app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3000/up || exit 1

CMD ["seki-web"]
