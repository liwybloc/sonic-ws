import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const [sourceName, destinationName] = process.argv.slice(2);

if (!sourceName || !destinationName) {
    throw new Error("usage: node copy-wasm.mjs <node|pkg> <destination>");
}

const source = resolve("src/native/wasm", sourceName);
const destination = resolve(destinationName);

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
