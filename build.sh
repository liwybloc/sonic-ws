#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$ROOT/projects/core"
RUST="$ROOT/projects/rust"
TS="$ROOT/projects/ts"
PY="$ROOT/projects/py"

python_for_tests() {
    local candidate

    if [[ -n "${SONICWS_PYTHON:-}" ]]; then
        if ! "$SONICWS_PYTHON" -c 'import wasmtime, websockets' >/dev/null 2>&1; then
            printf 'SONICWS_PYTHON does not provide wasmtime and websockets: %s\n' "$SONICWS_PYTHON" >&2
            exit 1
        fi
        printf '%s\n' "$SONICWS_PYTHON"
        return
    fi

    for candidate in \
        "${VIRTUAL_ENV:+$VIRTUAL_ENV/bin/python}" \
        "$PY/venv-sonic-ws/bin/python" \
        "$(command -v python3 2>/dev/null || true)"
    do
        if [[ -n "$candidate" && -x "$candidate" ]] \
            && "$candidate" -c 'import wasmtime, websockets' >/dev/null 2>&1
        then
            printf '%s\n' "$candidate"
            return
        fi
    done

    cat >&2 <<EOF
Python test dependencies are unavailable.
Create/install the project environment with:
  python3 -m venv "$PY/venv-sonic-ws"
  "$PY/venv-sonic-ws/bin/python" -m pip install -e "$PY"
Or set SONICWS_PYTHON to an interpreter containing wasmtime and websockets.
EOF
    exit 1
}

usage() {
    cat <<'EOF'
Usage: ./build.sh <command>

Build commands:
  all          Build Rust, TypeScript/Node/browser, and Python artifacts
  rust         Build the Rust codec core and native Rust runtime
  core         Build only the shared Rust codec core
  rust-runtime Build only the native Rust client/server package
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
  test_compat  Run one compatibility peer (language plus --host or --client)
  conformance  Run the shared Node and Python golden-vector corpus
  pack-node    Build and create the npm tarball
  benchmark    Build and run the reproducible codec benchmark suite
  check        Run non-networked static checks
  help         Show this message
EOF
}

build_core() {
    cargo build --release --manifest-path "$CORE/Cargo.toml"
}

build_rust_runtime() {
    cargo build --release --manifest-path "$RUST/Cargo.toml"
}

build_rust() {
    build_core
    build_rust_runtime
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
    cargo test --manifest-path "$RUST/Cargo.toml"
}

test_node() {
    (cd "$TS" && npm run test_node)
}

test_web() {
    (cd "$TS" && npm run test_web)
}

test_python() {
    local python
    python="$(python_for_tests)"
    export PYTHONPATH="$PY/src${PYTHONPATH:+:$PYTHONPATH}"
    "$python" "$PY/tests/test_codec.py"
    "$python" "$PY/tests/test_parity.py"
    "$python" "$PY/tests/test_conformance.py"
    "$python" -m unittest "$PY/tests/test_features.py" -v
    "$python" -m unittest "$PY/tests/test_security.py" -v
    "$python" -u "$PY/tests/test_integration.py"
    "$python" -u "$PY/tests/test_runtime.py"
}

test_conformance() {
    local python
    python="$(python_for_tests)"
    (cd "$TS" && npm run test_conformance)
    export PYTHONPATH="$PY/src${PYTHONPATH:+:$PYTHONPATH}"
    "$python" "$PY/tests/test_conformance.py"
}

test_compat() {
    local language="${1:-}"
    if [[ -z "$language" ]]; then
        printf 'Usage: ./build.sh test_compat <python|rust|typescript> <--host|--client>\n' >&2
        exit 2
    fi
    shift

    case "$language" in
        python|py)
            local python
            python="$(python_for_tests)"
            export PYTHONPATH="$PY/src${PYTHONPATH:+:$PYTHONPATH}"
            "$python" -u "$PY/tests/test_compat.py" "$@"
            ;;
        rust|rs)
            cargo run --manifest-path "$RUST/Cargo.toml" --bin test_compat -- "$@"
            ;;
        typescript|ts|node)
            build_node
            node "$TS/tests/test_compat.mjs" "$@"
            ;;
        *)
            printf 'Unknown compatibility implementation: %s\n' "$language" >&2
            printf 'Expected python, rust, or typescript.\n' >&2
            exit 2
            ;;
    esac
}

static_checks() {
    cargo check --manifest-path "$CORE/Cargo.toml"
    cargo check --manifest-path "$RUST/Cargo.toml"
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
    rust)
        build_rust
        ;;
    core)
        build_core
        ;;
    rust-runtime)
        build_rust_runtime
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
    test_compat|test-compat)
        shift
        test_compat "$@"
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
