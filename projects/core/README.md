# SonicWS Core

Rust implementation of the language-neutral SonicWS packet model and codec.

The legacy `gzip_compression` schema flag uses raw DEFLATE for TypeScript wire
compatibility; it does not produce a gzip container.
