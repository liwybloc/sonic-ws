import http from "node:http";
import express from "express";
import {
	SonicWSServer,
	CreatePacket,
	CreatePacketGroup,
	VariantPermutation,
	PacketType,
	PacketLogger
} from "../../projects/ts/dist/index.js";
import { FIXED_DT_SECONDS, stepPlayer } from "./public/physics.js";

const app = express();
const httpServer = http.createServer(app);
app.use(express.static("public"));
app.use("/vendor/three", express.static("node_modules/three/build"));

let nextEntityId = 1;
const entities = new Map();
const pendingInitialization = new WeakMap();
const pendingRemoval = new Map();

const wss = new SonicWSServer({
	clientPackets: [
		CreatePacket({
			tag: "click",
			type: PacketType.NONE
		}),
		...CreatePacketGroup({
			tag: "movement",
			variants: new VariantPermutation(
				[ "W", "A", "S", "D", "LOOK" ],
				[ [ 0, 2 ], [ 1, 3 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ] ]
			),
			defaults: {
				type: PacketType.VARINT,
				dataMax: 2, dataMin: 0,
				quantized: { scale: 1000 },
				schema: [ "dPitch", "dYaw" ],
				validator: (s, data) => data == null || (data.dPitch !== null && data.dYaw !== null), // verify that there is either no args or both args
			},
		})
	],
	serverPackets: [
		CreatePacket({
			tag: "pointsInfo",
			type: PacketType.UVARINT,
			replay: true
		}),
		CreatePacket({
			tag: "notification",
			type: PacketType.STRINGS_UTF16
		}),
		CreatePacket({
			tag: "selfEntity",
			type: PacketType.UVARINT,
			dataMax: 1
		}),
		CreatePacket({
			tag: "entitySnapshot",
			type: PacketType.VARINT,
			schema: ["id", "type", "x", "y", "z", "pitch", "yaw"],
			autoFlatten: true,
			quantized: {
				scale: 1000
			},
			replay: true
		}),
		...CreatePacketGroup({
			tag: "entity",
			variants: {
				move: {
					type: PacketType.VARINT,
					schema: ["id", "dx", "dy", "dz"],
					dataMax: 4,
					quantized: {
						scale: 1000
					},
				},
				look: {
					type: PacketType.VARINT,
					schema: ["id", "dPitch", "dYaw"],
					dataMax: 3,
					quantized: {
						scale: 1000
					},
				},
				both: {
					type: PacketType.VARINT,
					schema: ["id", "dx", "dy", "dz", "dPitch", "dYaw"],
					dataMax: 6,
					quantized: {
						scale: 1000
					},
				},
				remove: {
					type: PacketType.VARINT,
					schema: ["id"],
					dataMax: 1,
					replay: true
				},
			}
		})
	],
	websocketOptions: {
		server: httpServer
	},
	sonicServerSettings: {
		checkForUpdates: false
	},
	recovery: {
		maxDisconnectionMs: 5000,
		maxPackets: 128
	},
});

const snapshot = () => [...entities.values()].map(({
	id,
	position: {x, y, z},
	pitch,
	yaw
}) => ({
	id,
	type: 0,
	x,
	y,
	z,
	pitch,
	yaw
}));
const broadcastSnapshot = () => wss.broadcast("entitySnapshot", snapshot());

function createPlayer(ws) {
	const spawn = nextEntityId - 1;
	const entity = {
		id: nextEntityId++,
		position: {
			x: Math.sin(spawn) * 3,
			y: 1.7,
			z: 5 + Math.cos(spawn) * 3,
		},
		pitch: 0,
		yaw: 0,
		lastSeen: Date.now()
	};
	entities.set(entity.id, entity);
	ws.state = {
		clicks: 0,
		entityId: entity.id
	};
	return entity;
}

function configureConnection(ws, entity) {
	ws.on("click", () => ws.sendReliable("pointsInfo", ++ws.state.clicks));
	ws.on("movement", ({ variant, payload, permutation }) => {
		entity.lastSeen = Date.now();
		if(!variant) return; // Ignore the 1s keepalive

		const { W, A, S, D } = permutation;

		const { dPitch = 0, dYaw = 0 } = payload ?? {};
		if(dPitch || dYaw) {
			entity.pitch += dPitch;
			entity.yaw += dYaw;
		}

		const { dx, dy, dz } = stepPlayer(entity, { keys: { W, A, S, D }, dt: FIXED_DT_SECONDS });

		const moved = dx !== 0 || dy !== 0 || dz !== 0;
		const looked = dPitch || dYaw;

		if (moved && looked) {
			ws.broadcast("entity.both", {
				id: entity.id,
				dx,
				dy,
				dz,
				dPitch,
				dYaw
			});
		} else if (moved) {
			ws.broadcast("entity.move", {
				id: entity.id,
				dx,
				dy,
				dz
			});
		} else if (looked) {
			ws.broadcast("entity.look", {
				id: entity.id,
				dPitch,
				dYaw
			});
		}
	});
	ws.on_close(() => {
		const id = ws.state.entityId;
		if (!id || pendingRemoval.has(id)) return;
		pendingRemoval.set(id, setTimeout(() => {
			pendingRemoval.delete(id);
			entities.delete(id);
			void wss.broadcast("entity.remove", {
				id
			});
		}, 5000));
	});
}

function synchronize(ws, entity, recovered = false) {
	configureConnection(ws, entity);
	void ws.sendReliable("selfEntity", entity.id);
	void ws.sendReliable("pointsInfo", ws.state.clicks);
	void ws.sendReliable("notification", recovered ? "Session recovered" : "Welcome to the SonicWS 3D world");
	void ws.sendReliable("entitySnapshot", snapshot());
	void broadcastSnapshot();
}

wss.on_connect(ws => {
	// Recovery is presented immediately after the schema handshake. Delay fresh
	// allocation briefly so a replacement transport does not create a duplicate entity.
	pendingInitialization.set(ws, setTimeout(() => {
		pendingInitialization.delete(ws);
		if (!ws.state.entityId) synchronize(ws, createPlayer(ws));
	}, 100));
	// Development-only readable packet logs:
	if (process.env.SONIC_DEBUG_PACKETS) ws.addMiddleware(new PacketLogger());
});

wss.on_recovered(ws => {
	console.log("recovering", ws);
	clearTimeout(pendingInitialization.get(ws));
	pendingInitialization.delete(ws);
	const entity = entities.get(ws.state.entityId);
	if (!entity) return synchronize(ws, createPlayer(ws));
	clearTimeout(pendingRemoval.get(entity.id));
	pendingRemoval.delete(entity.id);
	synchronize(ws, entity, true);
});

setInterval(() => {
	const now = Date.now();
	for (const entity of entities.values())
		if (now - entity.lastSeen > 30_000 && !pendingRemoval.has(entity.id)) {
			entities.delete(entity.id);
			void wss.broadcast("entity.remove", {
				id: entity.id
			});
		}
}, 5000).unref();
setInterval(broadcastSnapshot, 15_000).unref();

httpServer.listen(6726, "localhost", () => console.log("SonicWS 3D world: http://localhost:6726"));
