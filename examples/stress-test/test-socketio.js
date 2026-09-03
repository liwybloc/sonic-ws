import http from "node:http";
import { Server } from "socket.io";
import { io as createClient } from "socket.io-client";

const CLIENT_COUNT = 50;
const SEND_HZ = 20;
const TEST_DURATION_MS = 30_000;
const PORT = 6731;

const httpServer = http.createServer();

const io = new Server(httpServer, {
	transports: ["websocket"],
	perMessageDeflate: false
});

let nextId = 1;

let c2sReceived = 0;
let c2sSent = 0;
let s2cReceived = 0;

const broadcastTimes = [];

function percentile(sorted, p) {
	if (!sorted.length) return 0;

	const index =
		Math.ceil((p / 100) * sorted.length) - 1;

	return sorted[
		Math.max(
			0,
			Math.min(index, sorted.length - 1)
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

	const sorted = [...samples].sort((a, b) => a - b);

	let total = 0;

	for (const value of sorted)
		total += value;

	return {
		samples: sorted.length,
		avgUs: total / sorted.length,
		p50Us: percentile(sorted, 50),
		p90Us: percentile(sorted, 90),
		p95Us: percentile(sorted, 95),
		p99Us: percentile(sorted, 99),
		maxUs: sorted[sorted.length - 1]
	};
}

function formatLatencyStats(samples) {
	const stats = calculateLatencyStats(samples);

	return {
		samples: stats.samples,
		avg: `${stats.avgUs.toFixed(2)} µs`,
		p50: `${stats.p50Us.toFixed(2)} µs`,
		p90: `${stats.p90Us.toFixed(2)} µs`,
		p95: `${stats.p95Us.toFixed(2)} µs`,
		p99: `${stats.p99Us.toFixed(2)} µs`,
		max: `${stats.maxUs.toFixed(2)} µs`
	};
}

io.on("connection", socket => {
	const id = nextId++;

	socket.on("ping-test", value => {
		c2sReceived++;
		socket.emit("pong-test", value);
	});

	socket.on("movement", packet => {
		c2sReceived++;

		const start = performance.now();

		switch (packet.variant) {
			case "move":
				socket.broadcast.emit("entity", {
					variant: "move",
					id,
					dx: packet.dx,
					dy: packet.dy,
					dz: packet.dz
				});
				break;

			case "look":
				socket.broadcast.emit("entity", {
					variant: "look",
					id,
					dPitch: packet.dPitch,
					dYaw: packet.dYaw
				});
				break;

			case "both":
				socket.broadcast.emit("entity", {
					variant: "both",
					id,
					dx: packet.dx,
					dy: packet.dy,
					dz: packet.dz,
					dPitch: packet.dPitch,
					dYaw: packet.dYaw
				});
				break;
		}

		broadcastTimes.push(
			(performance.now() - start) * 1000
		);
	});
});

function randomDelta() {
	return (Math.random() - 0.5) * 0.02;
}

async function createStressClient(index) {
	return new Promise((resolve, reject) => {
		const socket = createClient(
			`ws://localhost:${PORT}`,
			{
				transports: ["websocket"],
				reconnection: false,
				forceNew: true
			}
		);

		socket.on("connect", () => {
			console.log(
				`connected ${index + 1}/${CLIENT_COUNT}`
			);

			resolve(socket);
		});

		socket.on("connect_error", reject);

		socket.on("pong-test", () => {
			s2cReceived++;
		});

		socket.on("entity", () => {
			s2cReceived++;
		});
	});
}

function startClientTraffic(socket) {
	let tick = 0;

	return setInterval(() => {
		switch (tick++ % 3) {
			case 0:
				socket.emit("movement", {
					variant: "move",
					dx: randomDelta(),
					dy: 0,
					dz: randomDelta()
				});
				break;

			case 1:
				socket.emit("movement", {
					variant: "look",
					dPitch: randomDelta(),
					dYaw: randomDelta()
				});
				break;

			case 2:
				socket.emit("movement", {
					variant: "both",
					dx: randomDelta(),
					dy: 0,
					dz: randomDelta(),
					dPitch: randomDelta(),
					dYaw: randomDelta()
				});
				break;
		}

		c2sSent++;
	}, 1000 / SEND_HZ);
}

async function main() {
	await new Promise(resolve => {
		httpServer.listen(PORT, "localhost", resolve);
	});

	console.log(
		`Socket.IO server listening on ws://localhost:${PORT}`
	);

	const clients = await Promise.all(
		Array.from(
			{ length: CLIENT_COUNT },
			(_, i) => createStressClient(i)
		)
	);

	console.log(`\n${CLIENT_COUNT} clients ready`);
	console.log(`starting ${SEND_HZ} Hz traffic\n`);

	const start = performance.now();

	const timers =
		clients.map(startClientTraffic);

	const stats = setInterval(() => {
		const seconds =
			(performance.now() - start) / 1000;

		console.log({
			elapsed: seconds.toFixed(1),
			c2sSent,
			c2sReceived,
			s2cReceived,

			c2sPerSecond:
				Math.round(c2sReceived / seconds),

			s2cPerSecond:
				Math.round(s2cReceived / seconds),

			actualHzPerClient:
				(
					c2sReceived /
					seconds /
					CLIENT_COUNT
				).toFixed(2),

			broadcastLatency:
				formatLatencyStats(broadcastTimes)
		});
	}, 5000);

	await new Promise(resolve =>
		setTimeout(resolve, TEST_DURATION_MS)
	);

	clearInterval(stats);

	for (const timer of timers)
		clearInterval(timer);

	const seconds =
		(performance.now() - start) / 1000;

	console.log("\n=== FINAL: Socket.IO ===");

	console.log({
		clients: CLIENT_COUNT,
		sendHz: SEND_HZ,

		durationSeconds:
			seconds.toFixed(2),

		c2sSent,
		c2sReceived,
		s2cReceived,

		c2sPerSecond:
			Math.round(c2sReceived / seconds),

		s2cPerSecond:
			Math.round(s2cReceived / seconds),

		actualHzPerClient:
			(
				c2sReceived /
				seconds /
				CLIENT_COUNT
			).toFixed(2),

		expectedC2SPerSecond:
			CLIENT_COUNT * SEND_HZ,

		expectedS2CPerSecond:
			CLIENT_COUNT *
			(CLIENT_COUNT - 1) *
			SEND_HZ,

		expectedS2CFromActualC2S:
			Math.round(
				(c2sReceived / seconds) *
				(CLIENT_COUNT - 1)
			),

		fanoutEfficiency:
			(
				s2cReceived /
				(
					c2sReceived *
					(CLIENT_COUNT - 1)
				) *
				100
			).toFixed(2) + "%",

		broadcastLatency:
			formatLatencyStats(broadcastTimes)
	});

	for (const socket of clients)
		socket.close();

	await new Promise(resolve => {
		io.close(resolve);
	});

	if (httpServer.listening) {
		await new Promise((resolve, reject) => {
			httpServer.close(error =>
				error ? reject(error) : resolve()
			);
		});
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});