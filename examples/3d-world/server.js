import http from "node:http";
import express from "express";
import {
	SonicWSServer,
	CreatePacket,
	CreatePacketGroup,
	PacketType,
	PacketLogger
} from "sonic-ws";

const app = express();
const httpServer = http.createServer(app);
app.use(express.static("public"));
app.use("/vendor/three", express.static("node_modules/three/build"));

let nextEntityId = 1;
const entities = new Map();
const pendingInitialization = new WeakMap();
const pendingRemoval = new Map();

const movement = prefix => CreatePacketGroup({
	tag: prefix,
	variants: {
		move: {
			type: PacketType.VARINT,
			schema: prefix === "movement" ? ["dx", "dy", "dz"] : ["id", "dx", "dy", "dz"],
			dataMax: prefix === "movement" ? 3 : 4,
			quantized: {
				scale: 1000
			},
			...(prefix === "movement" ? {
				min: -10,
				max: 10
			} : {})
		},
		look: {
			type: PacketType.VARINT,
			schema: prefix === "movement" ? ["dPitch", "dYaw"] : ["id", "dPitch", "dYaw"],
			dataMax: prefix === "movement" ? 2 : 3,
			quantized: {
				scale: 1000
			},
			...(prefix === "movement" ? {
				min: -Math.PI * 2,
				max: Math.PI * 2
			} : {})
		},
		both: {
			type: PacketType.VARINT,
			schema: prefix === "movement" ? ["dx", "dy", "dz", "dPitch", "dYaw"] : ["id", "dx", "dy", "dz", "dPitch", "dYaw"],
			dataMax: prefix === "movement" ? 5 : 6,
			quantized: {
				scale: 1000
			},
			...(prefix === "movement" ? {
				min: -10,
				max: 10
			} : {})
		},
		...(prefix === "entity" ? {
			remove: {
				type: PacketType.VARINT,
				schema: ["id"],
				dataMax: 1,
				replay: true
			}
		} : {}),
	}
});

const wss = new SonicWSServer({
	clientPackets: [CreatePacket({
		tag: "click",
		type: PacketType.NONE
	}), ...movement("movement")],
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
			type: PacketType.VARINT,
			schema: ["id", "x", "y", "z", "pitch", "yaw", "lastSeen"],
			dataMax: 7,
			quantized: {
				scale: 1000
			},
			replay: true
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
		...movement("entity"),
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
	x,
	y,
	z,
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
		x: Math.sin(spawn) * 3,
		y: 1.7,
		z: 5 + Math.cos(spawn) * 3,
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

async function broadcastVolatileExcept(sender, tag, value) {
	await Promise.all(wss.connections.filter(connection => connection !== sender).map(connection => connection.sendVolatile(tag, value)));
}

function configureConnection(ws, entity) {
	ws.on("click", () => ws.sendReliable("pointsInfo", ++ws.state.clicks));
	ws.on("movement", ({
		variant,
		payload
	}) => {
		entity.lastSeen = Date.now();
		if (!payload) return;
		if (variant !== "look") {
			entity.x += payload.dx;
			entity.y += payload.dy;
			entity.z += payload.dz;
		}
		if (variant !== "move") {
			entity.pitch += payload.dPitch;
			entity.yaw += payload.dYaw;
		}
		void broadcastVolatileExcept(ws, `entity.${variant}`, {
			id: entity.id,
			...payload
		});
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
	void ws.sendReliable("selfEntity", entity);
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