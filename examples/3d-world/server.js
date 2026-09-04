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
export const entities = new Map();

export const wss = new SonicWSServer({
	clientPackets: [
		CreatePacket({
			tag: "click",
			type: PacketType.NONE
		}),
		...CreatePacketGroup({
			tag: "movement",
			variants: new VariantPermutation(
				["W", "A", "S", "D", "LOOK"],
				[[0, 2], [1, 3], [4, 0], [4, 1], [4, 2], [4, 3]]
			),
			defaults: {
				type: PacketType.VARINT,
				dataMax: 2,
				dataMin: 0,
				quantized: { scale: 1000 },
				schema: ["dPitch", "dYaw"],
				validator: (s, data) => data == null || (data.dPitch !== null && data.dYaw !== null),
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
			replay: true,
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

const snapshot = () =>
	[...entities.values()].map(({
		id,
		position: { x, y, z },
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

export const broadcastSnapshot = exclude => wss.broadcastFiltered(
	"entitySnapshot",
	ws => ws !== exclude && Boolean(ws.state.entityId),
	snapshot()
);

function createPlayer(ws) {
	const spawn = nextEntityId - 1;
	const entity = {
		id: nextEntityId++,
		position: {
			x: Math.sin(spawn) * 3,
			y: 0,
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
	ws.on("click", () =>
		ws.sendReliable("pointsInfo", ++ws.state.clicks)
	);

	ws.on("movement", ({ variant, payload, permutation }) => {
		entity.lastSeen = Date.now();

		if (!variant) return;

		const { dPitch = 0, dYaw = 0 } = payload ?? {};

		if (dPitch || dYaw) {
			entity.pitch += dPitch;
			entity.yaw += dYaw;
		}

		const { dx, dy, dz } = stepPlayer(entity, { keys: permutation, dt: FIXED_DT_SECONDS });

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

		entities.delete(id);
		void wss.broadcast("entity.remove", { id });
	});
}

function synchronize(ws, entity, recovered = false) {
	configureConnection(ws, entity);

	void ws.sendReliable("selfEntity", entity.id);
	void ws.sendReliable("pointsInfo", ws.state.clicks);
	void ws.sendReliable("notification", recovered ? "Session recovered" : "Welcome to the SonicWS 3D world");
	void ws.sendReliable("entitySnapshot", snapshot());
	void broadcastSnapshot(ws);
}

wss.on_connect(ws => {
	const initializationInterval = ws.setInterval(() => {
		if (ws.state.entityId) {
			clearInterval(initializationInterval);
			return;
		}

		clearInterval(initializationInterval);
		synchronize(ws, createPlayer(ws));
	}, 100);

	if (process.env.SONIC_DEBUG_PACKETS) ws.addMiddleware(new PacketLogger());
});

wss.on_recovered(ws => {
	const entity = entities.get(ws.state.entityId);

	if (!entity) {
		synchronize(ws, createPlayer(ws));
		return;
	}

	synchronize(ws, entity, true);
});

wss.setInterval(() => {
	const now = Date.now();

	for (const entity of entities.values()) {
		if (now - entity.lastSeen <= 30_000)
			continue;

		entities.delete(entity.id);

		void wss.broadcast("entity.remove", { id: entity.id });
	}
}, 5000);

wss.setInterval(broadcastSnapshot, 15_000);

const port = Number(process.env.SONIC_3D_PORT ?? 6726);

export const serverReady = new Promise(resolve => {
	httpServer.listen(port, "localhost", () => {
		const address = httpServer.address();
		const listeningPort = typeof address === "object" && address ? address.port : port;

		console.log(`SonicWS 3D world: http://localhost:${listeningPort}`);

		resolve(listeningPort);
	});
});

export async function shutdown() {
	await new Promise((resolve, reject) => wss.shutdown(error => error ? reject(error) : resolve()));
	await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
}