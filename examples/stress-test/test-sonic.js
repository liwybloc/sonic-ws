import http from "node:http";
import {
	SonicWS,
	SonicWSServer,
	CreatePacket,
	CreatePacketGroup,
	PacketType
} from "../../projects/ts/dist/index.js";

const CLIENT_COUNT = 50;
const SEND_HZ = 20;
const TEST_DURATION_MS = 30_000;
const PORT = 6730;

const httpServer = http.createServer();

const clientPackets = [
	CreatePacket({
		tag: "ping",
		type: PacketType.UVARINT,
		dataMax: 1
	}),

	...CreatePacketGroup({
		tag: "movement",
		variants: {
			move: {
				type: PacketType.VARINT,
				schema: ["dx", "dy", "dz"],
				dataMax: 3,
				quantized: {
					scale: 1000
				}
			},

			look: {
				type: PacketType.VARINT,
				schema: ["dPitch", "dYaw"],
				dataMax: 2,
				quantized: {
					scale: 1000
				}
			},

			both: {
				type: PacketType.VARINT,
				schema: [
					"dx",
					"dy",
					"dz",
					"dPitch",
					"dYaw"
				],
				dataMax: 5,
				quantized: {
					scale: 1000
				}
			}
		}
	})
];

const serverPackets = [
	CreatePacket({
		tag: "pong",
		type: PacketType.UVARINT,
		dataMax: 1
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
				}
			},

			look: {
				type: PacketType.VARINT,
				schema: ["id", "dPitch", "dYaw"],
				dataMax: 3,
				quantized: {
					scale: 1000
				}
			},

			both: {
				type: PacketType.VARINT,
				schema: [
					"id",
					"dx",
					"dy",
					"dz",
					"dPitch",
					"dYaw"
				],
				dataMax: 6,
				quantized: {
					scale: 1000
				}
			}
		}
	})
];

const wss = new SonicWSServer({
	clientPackets,
	serverPackets,

	websocketOptions: {
		server: httpServer
	},

	sonicServerSettings: {
		checkForUpdates: false
	}
});

wss.setServerRateLimit(0);

let nextId = 1;

let c2sSent = 0;
let c2sReceived = 0;
let s2cReceived = 0;

const broadcastTimes = [];

function percentile(sorted, percentile) {
	if (!sorted.length)
		return 0;

	const index =
		Math.ceil(
			(percentile / 100) *
			sorted.length
		) - 1;

	return sorted[
		Math.max(
			0,
			Math.min(
				index,
				sorted.length - 1
			)
		)
	];
}

function calculateLatencyStats(samples) {
	if (!samples.length) {
		return {
			samples: 0,
			avgUs: 0,
			p50Us: 0,
			p90Us: 0,
			p95Us: 0,
			p99Us: 0,
			maxUs: 0
		};
	}

	const sorted =
		[...samples].sort((a, b) => a - b);

	let total = 0;

	for (const sample of sorted)
		total += sample;

	return {
		samples: sorted.length,

		avgUs:
			total / sorted.length,

		p50Us:
			percentile(sorted, 50),

		p90Us:
			percentile(sorted, 90),

		p95Us:
			percentile(sorted, 95),

		p99Us:
			percentile(sorted, 99),

		maxUs:
			sorted[sorted.length - 1]
	};
}

function formatLatencyStats(samples) {
	const stats =
		calculateLatencyStats(samples);

	return {
		samples:
			stats.samples,

		avg:
			`${stats.avgUs.toFixed(2)} µs`,

		p50:
			`${stats.p50Us.toFixed(2)} µs`,

		p90:
			`${stats.p90Us.toFixed(2)} µs`,

		p95:
			`${stats.p95Us.toFixed(2)} µs`,

		p99:
			`${stats.p99Us.toFixed(2)} µs`,

		max:
			`${stats.maxUs.toFixed(2)} µs`
	};
}

wss.on_connect(ws => {
	ws.setBackpressureLimits({
		volatileAtBytes:
			64 * 1024 * 1024,

		closeAtBytes:
			256 * 1024 * 1024
	});

	const id = nextId++;

	ws.state = {
		id
	};

	ws.on("ping", value => {
		c2sReceived++;

		void ws.send(
			"pong",
			value
		);
	});

	ws.on(
		"movement",
		async ({
			variant,
			payload
		}) => {
			c2sReceived++;

			const start =
				performance.now();

			switch (variant) {
				case "move":
					await wss.broadcastFiltered(
						"entity.move",

						other =>
							other !== ws,

						{
							id,

							dx:
								payload.dx,

							dy:
								payload.dy,

							dz:
								payload.dz
						}
					);
					break;

				case "look":
					await wss.broadcastFiltered(
						"entity.look",

						other =>
							other !== ws,

						{
							id,

							dPitch:
								payload.dPitch,

							dYaw:
								payload.dYaw
						}
					);
					break;

				case "both":
					await wss.broadcastFiltered(
						"entity.both",

						other =>
							other !== ws,

						{
							id,

							dx:
								payload.dx,

							dy:
								payload.dy,

							dz:
								payload.dz,

							dPitch:
								payload.dPitch,

							dYaw:
								payload.dYaw
						}
					);
					break;
			}

			broadcastTimes.push(
				(
					performance.now() -
					start
				) * 1000
			);
		}
	);
});

function randomDelta() {
	return (
		Math.random() - 0.5
	) * 0.02;
}

async function createClient(index) {
	const ws =
		await SonicWS.connect(
			`ws://localhost:${PORT}`,
			{
				checkForUpdates: false
			}
		);

	ws.setBackpressureLimits({
		volatileAtBytes:
			64 * 1024 * 1024,

		closeAtBytes:
			256 * 1024 * 1024
	});

	ws.on("pong", () => {
		s2cReceived++;
	});

	ws.on("entity", () => {
		s2cReceived++;
	});

	console.log(
		`connected ${index + 1}/${CLIENT_COUNT}`
	);

	return ws;
}

function startClientTraffic(ws) {
	let tick = 0;

	ws.setInterval(() => {
		switch (tick++ % 3) {
			case 0:
				void ws.sendVariant(
					"movement",
					"move",
					{
						dx:
							randomDelta(),

						dy:
							0,

						dz:
							randomDelta()
					}
				);
				break;

			case 1:
				void ws.sendVariant(
					"movement",
					"look",
					{
						dPitch:
							randomDelta(),

						dYaw:
							randomDelta()
					}
				);
				break;

			case 2:
				void ws.sendVariant(
					"movement",
					"both",
					{
						dx:
							randomDelta(),

						dy:
							0,

						dz:
							randomDelta(),

						dPitch:
							randomDelta(),

						dYaw:
							randomDelta()
					}
				);
				break;
		}

		c2sSent++;

	}, 1000 / SEND_HZ);
}

async function main() {
	await new Promise(resolve => {
		httpServer.listen(
			PORT,
			"localhost",
			resolve
		);
	});

	console.log(
		`SonicWS server listening on ws://localhost:${PORT}`
	);

	const clients =
		await Promise.all(
			Array.from(
				{
					length:
						CLIENT_COUNT
				},
				(_, index) =>
					createClient(index)
			)
		);

	console.log(
		`\n${CLIENT_COUNT} clients ready`
	);

	console.log(
		`starting ${SEND_HZ} Hz traffic\n`
	);

	const start =
		performance.now();

	for (const ws of clients)
		startClientTraffic(ws);

	wss.setInterval(() => {
		const seconds =
			(
				performance.now() -
				start
			) / 1000;

		console.log({
			elapsed:
				seconds.toFixed(1),

			c2sSent,
			c2sReceived,
			s2cReceived,

			c2sPerSecond:
				Math.round(
					c2sReceived /
					seconds
				),

			s2cPerSecond:
				Math.round(
					s2cReceived /
					seconds
				),

			actualHzPerClient:
				(
					c2sReceived /
					seconds /
					CLIENT_COUNT
				).toFixed(2),

			broadcastLatency:
				formatLatencyStats(
					broadcastTimes
				)
		});

	}, 5000);

	await new Promise(resolve =>
		setTimeout(
			resolve,
			TEST_DURATION_MS
		)
	);

	const seconds =
		(
			performance.now() -
				start
		) / 1000;

	console.log(
		"\n=== FINAL: SonicWS ==="
	);

	console.log({
		clients:
			CLIENT_COUNT,

		sendHz:
			SEND_HZ,

		durationSeconds:
			seconds.toFixed(2),

		c2sSent,
		c2sReceived,
		s2cReceived,

		c2sPerSecond:
			Math.round(
				c2sReceived /
				seconds
			),

		s2cPerSecond:
			Math.round(
				s2cReceived /
				seconds
			),

		actualHzPerClient:
			(
				c2sReceived /
				seconds /
				CLIENT_COUNT
			).toFixed(2),

		expectedC2SPerSecond:
			CLIENT_COUNT *
			SEND_HZ,

		expectedS2CPerSecond:
			CLIENT_COUNT *
			(CLIENT_COUNT - 1) *
			SEND_HZ,

		expectedS2CFromActualC2S:
			Math.round(
				(
					c2sReceived /
					seconds
				) *
				(
					CLIENT_COUNT -
					1
				)
			),

		fanoutEfficiency:
			(
				s2cReceived /
				(
					c2sReceived *
					(
						CLIENT_COUNT -
						1
					)
				) *
				100
			).toFixed(2) + "%",

		broadcastLatency:
			formatLatencyStats(
				broadcastTimes
			)
	});

	for (const ws of clients)
		ws.close();

	await new Promise(
		(resolve, reject) => {
			wss.shutdown(error =>
				error
					? reject(error)
					: resolve()
			);
		}
	);

	await new Promise(
		(resolve, reject) => {
			httpServer.close(error =>
				error
					? reject(error)
					: resolve()
			);
		}
	);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
