# Quickstart: Verification Commands

**Feature**: Refactor Large Files

## Before starting any refactoring

```bash
# Full Rust test suite (baseline)
cargo test --all

# Frontend typecheck + tests (baseline)
cd seki-web/frontend && pnpm run typecheck && pnpm test
```

## After each module split

```bash
# Verify Rust
cargo test --all

# Verify TypeScript
cd seki-web/frontend && pnpm run typecheck && pnpm test
```

## File size check (after all splits)

```bash
# List non-test source files over 500 lines
find . -name "*.rs" -o -name "*.ts" -o -name "*.tsx" \
  | grep -v node_modules | grep -v target | grep -v __tests__ \
  | xargs wc -l | awk '$1 > 500 {print $0}' | sort -rn

# If any files remain over 500 lines, verify they have documented justification
```

## Full verification (final)

```bash
# Build all crates
cargo build

# Full test suite
cargo test --all

# WASM build
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm

# Frontend
cd seki-web/frontend
pnpm run build
pnpm run typecheck
pnpm test
```
