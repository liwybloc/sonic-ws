import { SonicWS } from "../../projects/ts/dist/index.js";
import { FIXED_DT_SECONDS, stepPlayer } from "./public/physics.js";

process.env.SONIC_3D_PORT = "0";
const {
	entities: serverEntities,
	broadcastSnapshot,
	serverReady,
	shutdown,
	wss,
} = await import("./server.js");

const CLIENT_COUNT = 2;
const TICKS = 600;
const TICK_MS = 50;
const POSITION_TOLERANCE = 0.075;
const ANGLE_TOLERANCE = 0.002;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function copyEntity(value) {
	return {
		id: value.id,
		position: {
			x: value.position?.x ?? value.x,
			y: value.position?.y ?? value.y,
			z: value.position?.z ?? value.z,
		},
		pitch: value.pitch ?? 0,
		yaw: value.yaw ?? 0,
	};
}

function applyUpdate(target, data) {
	target.position.x += data.dx ?? 0;
	target.position.y += data.dy ?? 0;
	target.position.z += data.dz ?? 0;
	target.pitch += data.dPitch ?? 0;
	target.yaw += data.dYaw ?? 0;
}

async function connectClient(name, url) {
	const ws = new SonicWS(url);
	const state = {
		name,
		ws,
		selfId: undefined,
		entities: new Map(),
		snapshots: 0,
		receivedSelfSnapshot: false,
	};

	ws.on("selfEntity", id => {
		state.selfId = id;
	});
	ws.on("entitySnapshot", snapshot => {
		for (const value of snapshot) {
			if (value.id === state.selfId && state.receivedSelfSnapshot) continue;
			state.entities.set(value.id, copyEntity(value));
		}
		state.receivedSelfSnapshot ||= snapshot.some(value => value.id === state.selfId);
		state.snapshots++;
	});
	ws.on("pointsInfo", () => {});
	ws.on("notification", () => {});
	for (const tag of ["entity.move", "entity.look", "entity.both"]) {
		ws.on(tag, data => {
			const entity = state.entities.get(data.id);
			if (entity) applyUpdate(entity, data);
		});
	}

	await new Promise((resolve, reject) => {
		ws.on_ready(resolve);
		ws.on_close((code, reason) => reject(new Error(
			`${name} closed before ready (${code}: ${String(reason)})`,
		)));
	});

	return state;
}

async function waitForInitialState(clients) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (clients.every(client =>
			client.selfId !== undefined &&
			client.entities.size === CLIENT_COUNT
		)) return;
		await sleep(10);
	}
	throw new Error(`Clients did not receive the two-player initial snapshot: ${JSON.stringify(
		clients.map(client => ({
			name: client.name,
			selfId: client.selfId,
			entities: [...client.entities.keys()],
			snapshots: client.snapshots,
		})),
	)}`);
}

function inputFor(rng) {
	const axis = () => rng() < 0.4 ? -1 : rng() < 0.67 ? 0 : 1;
	const forward = axis();
	const sideways = axis();
	const keys = {
		W: forward < 0,
		A: sideways < 0,
		S: forward > 0,
		D: sideways > 0,
	};
	const dPitch = rng() < 0.35 ? Math.round((rng() - 0.5) * 20) / 1000 : 0;
	const dYaw = rng() < 0.7 ? Math.round((rng() - 0.5) * 40) / 1000 : 0;
	return { keys, dPitch, dYaw };
}

async function sendInput(client, input) {
	const own = client.entities.get(client.selfId);
	if (!own) throw new Error(`${client.name} has no local self entity`);

	own.pitch += input.dPitch;
	own.yaw += input.dYaw;
	stepPlayer(own, { keys: input.keys, dt: FIXED_DT_SECONDS });

	const looked = input.dPitch !== 0 || input.dYaw !== 0;
	const moving = Object.values(input.keys).some(Boolean);
	const permutation = {
		...input.keys,
		LOOK: looked && !moving,
	};
	const payload = looked ? { dPitch: input.dPitch, dYaw: input.dYaw } : undefined;

	if (payload) await client.ws.sendPermutation("movement", permutation, payload);
	else await client.ws.sendPermutation("movement", permutation);
}

function difference(expected, actual) {
	return {
		dx: actual.position.x - expected.position.x,
		dy: actual.position.y - expected.position.y,
		dz: actual.position.z - expected.position.z,
		dPitch: actual.pitch - expected.pitch,
		dYaw: actual.yaw - expected.yaw,
	};
}

function withinTolerance(delta) {
	return Math.abs(delta.dx) <= POSITION_TOLERANCE &&
		Math.abs(delta.dy) <= POSITION_TOLERANCE &&
		Math.abs(delta.dz) <= POSITION_TOLERANCE &&
		Math.abs(delta.dPitch) <= ANGLE_TOLERANCE &&
		Math.abs(delta.dYaw) <= ANGLE_TOLERANCE;
}

function compareState(clients, label) {
	const valueRows = [];
	const differenceRows = [];
	let passed = true;
	for (const serverEntity of serverEntities.values()) {
		const expected = copyEntity(serverEntity);
		valueRows.push({
			entity: expected.id,
			source: "server",
			x: expected.position.x.toFixed(4),
			y: expected.position.y.toFixed(4),
			z: expected.position.z.toFixed(4),
			pitch: expected.pitch.toFixed(4),
			yaw: expected.yaw.toFixed(4),
		});
		for (const client of clients) {
			const actual = client.entities.get(expected.id);
			if (!actual) {
				passed = false;
				differenceRows.push({ entity: expected.id, observer: client.name, result: "missing" });
				continue;
			}

			const delta = difference(expected, actual);
			const matches = withinTolerance(delta);
			passed &&= matches;
			valueRows.push({
				entity: expected.id,
				source: client.name,
				x: actual.position.x.toFixed(4),
				y: actual.position.y.toFixed(4),
				z: actual.position.z.toFixed(4),
				pitch: actual.pitch.toFixed(4),
				yaw: actual.yaw.toFixed(4),
			});
			differenceRows.push({
				entity: expected.id,
				observer: client.name,
				dx: delta.dx.toFixed(4),
				dy: delta.dy.toFixed(4),
				dz: delta.dz.toFixed(4),
				dPitch: delta.dPitch.toFixed(4),
				dYaw: delta.dYaw.toFixed(4),
				result: matches ? "pass" : "FAIL",
			});
		}
	}

	console.log(`${label} values:`);
	console.table(valueRows);
	console.log(`${label}, client minus server:`);
	console.table(differenceRows);
	return passed;
}

const port = await serverReady;
const serverUrl = `ws://localhost:${port}`;
const clients = [];

try {
	wss.setClientRateLimit(0);
	wss.setServerRateLimit(0);

	for (let index = 0; index < CLIENT_COUNT; index++) {
		clients.push(await connectClient(`client ${index + 1}`, serverUrl));
	}
	await waitForInitialState(clients);

	const rng = random(0x5eed1234);
	for (let tick = 0; tick < TICKS; tick++) {
		await Promise.all(clients.map(client => sendInput(client, inputFor(rng))));
		await sleep(TICK_MS);
	}

	await sleep(250);

	const automaticPassed = compareState(clients, "After automatic snapshots");
	console.log("Snapshots received:", Object.fromEntries(clients.map(client => [client.name, client.snapshots])));

	await broadcastSnapshot();
	await sleep(250);
	const forcedPassed = compareState(clients, "After forced snapshot");
	console.log(`Compared server + ${CLIENT_COUNT} clients after ${TICKS} ticks (${TICKS * TICK_MS} ms).`);
	if (!automaticPassed || !forcedPassed) {
		throw new Error("Client state diverged from authoritative server state");
	}
} finally {
	for (const client of clients) client.ws.close();
	await sleep(100);
	await shutdown();
}
