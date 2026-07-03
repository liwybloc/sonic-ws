/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import {
	chromium
} from "playwright";

delete process.env.SONIC_WS_CORE_PATH; // Exercise the Node WASM fallback on the server too.

const {
	SonicWSServer,
	PacketType,
	CreatePacket,
	CreateObjPacket,
	CreateEnumPacket,
	DefineEnum,
	WrapEnum
} = await import("../dist/index.js");

const mixedEnum = DefineEnum("web-mixed", ["alpha", 7, true, null, undefined]);
const objectEnum = DefineEnum("web-object", ["left", "right"]);
const cases = [{
		name: "none",
		create: tag => CreatePacket({
			tag,
			type: PacketType.NONE,
			dataMin: 0,
			dataMax: 0
		}),
		send: [],
		expected: [undefined]
	},
	{
		name: "raw",
		create: tag => CreatePacket({
			tag,
			type: PacketType.RAW,
			dataMin: 4,
			dataMax: 4
		}),
		send: [0, 1, 128, 255],
		expected: [Uint8Array.from([0, 1, 128, 255])]
	},
	{
		name: "ascii",
		create: tag => CreatePacket({
			tag,
			type: PacketType.STRINGS_ASCII,
			dataMin: 3,
			dataMax: 3
		}),
		send: ["hello world", "SonicWS", ""],
		expected: ["hello world", "SonicWS", ""]
	},
	{
		name: "utf16",
		create: tag => CreatePacket({
			tag,
			type: PacketType.STRINGS_UTF16,
			dataMin: 4,
			dataMax: 4
		}),
		send: ["another😂", "𐍈", "𝄞", "🧪"],
		expected: ["another😂", "𐍈", "𝄞", "🧪"]
	},
	{
		name: "enums",
		create: tag => CreateEnumPacket({
			tag,
			enumData: mixedEnum,
			dataMin: 5,
			dataMax: 5
		}),
		send: mixedEnum.values.map(value => WrapEnum(mixedEnum.tag, value)),
		expected: [...mixedEnum.values]
	},
	{
		name: "bytes",
		create: tag => CreatePacket({
			tag,
			type: PacketType.BYTES,
			dataMin: 5,
			dataMax: 5
		}),
		send: [-128, -1, 0, 1, 127],
		expected: [-128, -1, 0, 1, 127]
	},
	{
		name: "ubytes",
		create: tag => CreatePacket({
			tag,
			type: PacketType.UBYTES,
			dataMin: 4,
			dataMax: 4
		}),
		send: [0, 1, 254, 255],
		expected: [0, 1, 254, 255]
	},
	{
		name: "shorts",
		create: tag => CreatePacket({
			tag,
			type: PacketType.SHORTS,
			dataMin: 5,
			dataMax: 5
		}),
		send: [-32768, -1, 0, 1, 32767],
		expected: [-32768, -1, 0, 1, 32767]
	},
	{
		name: "ushorts",
		create: tag => CreatePacket({
			tag,
			type: PacketType.USHORTS,
			dataMin: 4,
			dataMax: 4
		}),
		send: [0, 1, 65534, 65535],
		expected: [0, 1, 65534, 65535]
	},
	{
		name: "varint",
		create: tag => CreatePacket({
			tag,
			type: PacketType.VARINT,
			dataMin: 5,
			dataMax: 5
		}),
		send: [-2147483648, -1, 0, 1, 2147483647],
		expected: [-2147483648, -1, 0, 1, 2147483647]
	},
	{
		name: "uvarint",
		create: tag => CreatePacket({
			tag,
			type: PacketType.UVARINT,
			dataMin: 7,
			dataMax: 7
		}),
		send: [0, 1, 127, 128, 255, 16384, 4294967295],
		expected: [0, 1, 127, 128, 255, 16384, 4294967295]
	},
	{
		name: "deltas",
		create: tag => CreatePacket({
			tag,
			type: PacketType.DELTAS,
			dataMin: 8,
			dataMax: 8
		}),
		send: [-50, -25, 1, 2, 1000, 1004, 1004, -5],
		expected: [-50, -25, 1, 2, 1000, 1004, 1004, -5]
	},
	{
		name: "floats",
		create: tag => CreatePacket({
			tag,
			type: PacketType.FLOATS,
			dataMin: 5,
			dataMax: 5
		}),
		send: [0, 1.5, -1.5, 958412.128498, 1e-10],
		expected: [0, 1.5, -1.5, Math.fround(958412.128498), Math.fround(1e-10)]
	},
	{
		name: "doubles",
		create: tag => CreatePacket({
			tag,
			type: PacketType.DOUBLES,
			dataMin: 5,
			dataMax: 5
		}),
		send: [0, 1.5, -1.5, 958412.128498, Infinity],
		expected: [0, 1.5, -1.5, 958412.1284979999, Infinity]
	},
	{
		name: "booleans",
		create: tag => CreatePacket({
			tag,
			type: PacketType.BOOLEANS,
			dataMin: 9,
			dataMax: 9
		}),
		send: [true, false, true, false, true, false, true, false, true],
		expected: [true, false, true, false, true, false, true, false, true]
	},
	{
		name: "json",
		create: tag => CreatePacket({
			tag,
			type: PacketType.JSON,
			dataMin: 1,
			dataMax: 1
		}),
		send: [{
			ok: true,
			nested: [1, "two", false, null]
		}],
		expected: [{
			ok: true,
			nested: [1, "two", false, null]
		}]
	},
	{
		name: "hex",
		create: tag => CreatePacket({
			tag,
			type: PacketType.HEX,
			dataMin: 1,
			dataMax: 3
		}),
		send: ["00abff"],
		expected: ["00abff"]
	},
	{
		name: "object",
		create: tag => CreateObjPacket({
			tag,
			types: [PacketType.STRINGS_ASCII, PacketType.BOOLEANS, PacketType.BYTES, objectEnum, PacketType.JSON],
			dataMins: [2, 3, 3, 2, 1],
			dataMaxes: [2, 3, 3, 2, 1],
			gzipCompression: false
		}),
		send: [
			["hello", "world"],
			[true, false, true],
			[-1, 0, 1],
			[WrapEnum(objectEnum.tag, "right"), WrapEnum(objectEnum.tag, "left")],
			[{ json: true }]
		],
		expected: [
			["hello", "world"],
			[true, false, true],
			[-1, 0, 1],
			["right", "left"],
			[{ json: true }]
		]
	},
	{
		name: "batch",
		create: tag => CreatePacket({
			tag,
			type: PacketType.UVARINT,
			dataMin: 3,
			dataMax: 3,
			dataBatching: 10,
			maxBatchSize: 4,
			gzipCompression: true
		}),
		send: [7, 128, 16384],
		expected: [7, 128, 16384]
	},
];

const normalize = value => value instanceof Uint8Array ? [...value] : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)])) : value;
const makePackets = prefix => cases.map(testCase => testCase.create(`${prefix}_${testCase.name}`));
const withTimeout = (promise, milliseconds, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds))]);

const httpServer = http.createServer((req, res) => {
	if (new URL(req.url ?? "/", "http://localhost").pathname === "/") {
		res.writeHead(200, { "content-type": "text/html" });
		res.end('<!doctype html><meta charset="utf-8"><script src="/SonicWS/bundle.js"></script>');
		return;
	}
	res.writeHead(404);
	res.end();
});

const sonicServer = new SonicWSServer({
	clientPackets: makePackets("client"),
	serverPackets: makePackets("server"),
	websocketOptions: {
		server: httpServer
	},
	sonicServerSettings: {
		checkForUpdates: false
	}
});
let browser;
try {
	await new Promise((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(0, "127.0.0.1", resolve);
	});
	const address = httpServer.address();
	assert(address && typeof address !== "string");
	const connectionPromise = new Promise(resolve => sonicServer.on_connect(connection => {
		const received = cases.map(testCase => new Promise((resolveCase, rejectCase) => connection.on(`client_${testCase.name}`, (...actual) => {
			try {
				assert.deepStrictEqual(normalize(actual), normalize(testCase.expected));
				resolveCase();
			} catch (error) {
				rejectCase(error);
			}
		})));
		resolve({
			connection,
			received
		});
	}));
	browser = await chromium.launch({
		headless: true
	});
	const page = await browser.newPage();
	page.on("console", message => console.log(`browser: ${message.text()}`));
	page.on("pageerror", error => console.error(`browser error: ${error.message}`));
	await page.goto(`http://127.0.0.1:${address.port}/`);
	const browserResult = page.evaluate(async port => {
		const normalize = value => value instanceof Uint8Array ? [...value] : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)])) : value;
		const equal = (actual, expected) => JSON.stringify(normalize(actual), (_, value) => value === undefined ? "__undefined__" : value) === JSON.stringify(normalize(expected), (_, value) => value === undefined ? "__undefined__" : value);
		await window.SonicWS.initialize();
		console.log("WASM initialized");
		const socket = new window.SonicWS(`ws://127.0.0.1:${port}`);
		const mixed = ["alpha", 7, true, null, undefined],
			objectValues = ["left", "right"];
		const cases = [
			["none", [],
				[undefined]
			],
			["raw", [0, 1, 128, 255],
				[new Uint8Array([0, 1, 128, 255])]
			],
			["ascii", ["hello world", "SonicWS", ""],
				["hello world", "SonicWS", ""]
			],
			["utf16", ["another😂", "𐍈", "𝄞", "🧪"],
				["another😂", "𐍈", "𝄞", "🧪"]
			],
			["enums", [0, 1, 2, 3, 4], mixed],
			["bytes", [-128, -1, 0, 1, 127],
				[-128, -1, 0, 1, 127]
			],
			["ubytes", [0, 1, 254, 255],
				[0, 1, 254, 255]
			],
			["shorts", [-32768, -1, 0, 1, 32767],
				[-32768, -1, 0, 1, 32767]
			],
			["ushorts", [0, 1, 65534, 65535],
				[0, 1, 65534, 65535]
			],
			["varint", [-2147483648, -1, 0, 1, 2147483647],
				[-2147483648, -1, 0, 1, 2147483647]
			],
			["uvarint", [0, 1, 127, 128, 255, 16384, 4294967295],
				[0, 1, 127, 128, 255, 16384, 4294967295]
			],
			["deltas", [-50, -25, 1, 2, 1000, 1004, 1004, -5],
				[-50, -25, 1, 2, 1000, 1004, 1004, -5]
			],
			["floats", [0, 1.5, -1.5, 958412.128498, 1e-10],
				[0, 1.5, -1.5, Math.fround(958412.128498), Math.fround(1e-10)]
			],
			["doubles", [0, 1.5, -1.5, 958412.128498, Infinity],
				[0, 1.5, -1.5, 958412.1284979999, Infinity]
			],
			["booleans", [true, false, true, false, true, false, true, false, true],
				[true, false, true, false, true, false, true, false, true]
			],
			["json", [{
					ok: true,
					nested: [1, "two", false, null]
				}],
				[{
					ok: true,
					nested: [1, "two", false, null]
				}]
			],
			["hex", ["00abff"],
				["00abff"]
			],
			["object", [
					["hello", "world"],
					[true, false, true],
					[-1, 0, 1],
					[1, 0],
					[{ json: true }]
				],
				[
					["hello", "world"],
					[true, false, true],
					[-1, 0, 1],
					["right", "left"],
					[{ json: true }]
				]
			],
			["batch", [7, 128, 16384],
				[7, 128, 16384]
			],
		];
		const received = cases.map(([name, , expected]) => new Promise((resolve, reject) => socket.on(`server_${name}`, (...actual) => equal(actual, expected) ? resolve(name) : reject(new Error(`${name}: ${JSON.stringify(normalize(actual))}`)))));
		await new Promise(resolve => socket.on_ready(resolve));
		console.log("SonicWS handshake ready");
		for (const [name, send] of cases) await socket.send(`client_${name}`, ...send);
		await Promise.all(received);
		return cases.length;
	}, address.port);
	const {
		connection,
		received: serverReceived
	} = await withTimeout(connectionPromise, 5_000, "browser connection");
	for (const testCase of cases) await connection.send(`server_${testCase.name}`, ...testCase.send);
	await Promise.race([Promise.all(serverReceived), new Promise((_, reject) => setTimeout(() => reject(new Error("web packet timeout")), 10_000))]);
	assert.equal(await withTimeout(browserResult, 10_000, "browser packet roundtrips"), cases.length);
	console.log(`passed ${cases.length*2} browser WASM packet roundtrips across ${cases.length} packet definitions`);

	const wasmFixture = await readFile(new URL("../../../bundled/bundle.wasm", import.meta.url));
	const fallbackPage = await browser.newPage();
	await fallbackPage.route("**/SonicWS/bundle.wasm", route => route.fulfill({ status: 404, body: "missing" }));
	await fallbackPage.route("https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/version", route => route.fulfill({ status: 200, body: "23" }));
	await fallbackPage.route("https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/bundle.wasm", route => route.fulfill({ status: 200, contentType: "application/wasm", body: wasmFixture }));
	await fallbackPage.goto(`http://127.0.0.1:${address.port}/`);
	assert.equal(await fallbackPage.evaluate(async () => {
		await window.SonicWS.initialize();
		return true;
	}), true);
	await fallbackPage.close();
	console.log("browser: missing local WASM used the version-matched CDN fallback");

	const mismatchPage = await browser.newPage();
	await mismatchPage.route("**/SonicWS/bundle.wasm", route => route.fulfill({ status: 404, body: "missing" }));
	await mismatchPage.route("https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/version", route => route.fulfill({ status: 200, body: "999" }));
	await mismatchPage.goto(`http://127.0.0.1:${address.port}/`);
	const mismatch = await mismatchPage.evaluate(async () => {
		try {
			await window.SonicWS.initialize();
			return "";
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});
	assert.match(mismatch, /CDN protocol mismatch: expected 23, received 999/);
	await mismatchPage.close();
	console.log("browser: mismatched CDN protocol was rejected");
} finally {
	if (browser) await browser.close();
	await withTimeout(new Promise(resolve => sonicServer.shutdown(() => resolve())), 2_000, "SonicWS server shutdown").catch(() => undefined);
	await withTimeout(new Promise(resolve => httpServer.close(() => resolve())), 2_000, "HTTP server shutdown").catch(() => undefined);
}
