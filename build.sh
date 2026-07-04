#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$ROOT/projects/core"
TS="$ROOT/projects/ts"
PY="$ROOT/projects/py"

usage() {
    cat <<'EOF'
Usage: ./build.sh <command>

Build commands:
  all          Build Rust, TypeScript/Node/browser, and Python artifacts
  rust         Build the Rust core in release mode
  ts           Build the complete TypeScript package and browser bundle
  node         Build the Node distribution and Node WASM fallback
  web          Build the browser JavaScript and WASM bundle
  py           Build the Python wheel and source distribution
  py-wheel     Build only the Python wheel
  py-sdist     Build only the self-contained Python source distribution

Test and packaging commands:
  test         Run Rust, Node, browser, and Python tests
  test-rust    Run the Rust test suite
  test-node    Run the Node end-to-end suite
  test-web     Run the browser/WASM end-to-end suite
  test-py      Run Python codec, parity, integration, and runtime tests
  conformance  Run the shared Node and Python golden-vector corpus
  pack-node    Build and create the npm tarball
  benchmark    Build and run the reproducible codec benchmark suite
  check        Run non-networked static checks
  help         Show this message
EOF
}

build_rust() {
    cargo build --release --manifest-path "$CORE/Cargo.toml"
}

build_ts() {
    (cd "$TS" && npm run build)
}

build_node() {
    (cd "$TS" && npm run build_node)
}

build_web() {
    (cd "$TS" && npm run build_web)
}

build_python() {
    python3 -m build --no-isolation --wheel --sdist "$PY"
}

build_python_wheel() {
    python3 -m build --no-isolation --wheel "$PY"
}

build_python_sdist() {
    python3 -m build --no-isolation --sdist "$PY"
}

test_rust() {
    cargo test --manifest-path "$CORE/Cargo.toml"
}

test_node() {
    (cd "$TS" && npm run test_node)
}

test_web() {
    (cd "$TS" && npm run test_web)
}

test_python() {
    export PYTHONPATH="$PY/src${PYTHONPATH:+:$PYTHONPATH}"
    python3 "$PY/tests/test_codec.py"
    python3 "$PY/tests/test_parity.py"
    python3 "$PY/tests/test_conformance.py"
    python3 -m unittest "$PY/tests/test_features.py" -v
    python3 -m unittest "$PY/tests/test_security.py" -v
    python3 -u "$PY/tests/test_integration.py"
    python3 -u "$PY/tests/test_runtime.py"
}

test_conformance() {
    (cd "$TS" && npm run test_conformance)
    export PYTHONPATH="$PY/src${PYTHONPATH:+:$PYTHONPATH}"
    python3 "$PY/tests/test_conformance.py"
}

static_checks() {
    cargo check --manifest-path "$CORE/Cargo.toml"
    (cd "$TS" && npx tsc --noEmit)
    python3 -m compileall -q "$PY/src" "$PY/tests"
}

command="${1:-help}"

case "$command" in
    all)
        build_rust
        build_ts
        build_python
        ;;
    rust|core)
        build_rust
        ;;
    ts)
        build_ts
        ;;
    node|ts-node)
        build_node
        ;;
    web|ts-web)
        build_web
        ;;
    py|python)
        build_python
        ;;
    py-wheel)
        build_python_wheel
        ;;
    py-sdist)
        build_python_sdist
        ;;
    test)
        test_rust
        test_node
        test_web
        test_python
        ;;
    test-rust)
        test_rust
        ;;
    test-node)
        test_node
        ;;
    test-web)
        test_web
        ;;
    test-py)
        test_python
        ;;
    conformance)
        test_conformance
        ;;
    pack-node)
        (cd "$TS" && npm pack)
        ;;
    benchmark)
        (cd "$TS" && npm run benchmark)
        ;;
    check)
        static_checks
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        printf 'Unknown command: %s\n\n' "$command" >&2
        usage >&2
        exit 2
        ;;
esac
