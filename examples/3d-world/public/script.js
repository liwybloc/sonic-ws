import * as THREE from "/vendor/three/three.module.js";

import {
	FIXED_DT_MS,
	FIXED_DT_SECONDS,
	MAX_CATCH_UP_TICKS,
	EYE_HEIGHT,
	CAPSULE_RADIUS,
	CAPSULE_LENGTH,
	CAPSULE_CENTER_Y,
	applyLook,
	stepPlayer
} from "./physics.js";

const ws = await SonicWS.connect(`ws://${location.host}`, {
	reconnect: {
		enabled: true,
		attempts: Infinity,
		minDelayMs: 250,
		maxDelayMs: 5000
	}
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
	75,
	innerWidth / innerHeight,
	0.1,
	1000
);

const renderer = new THREE.WebGLRenderer({
	antialias: true
});

renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x335533, 2));

const ground = new THREE.Mesh(
	new THREE.PlaneGeometry(200, 200),
	new THREE.MeshStandardMaterial({
		color: 0x3f8f3f
	})
);

ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 200));

const player = {
	position: {
		x: 0,
		y: 0,
		z: 5
	},
	pitch: 0,
	yaw: 0
};
const visualPlayerPosition = new THREE.Vector3(
	player.position.x,
	player.position.y,
	player.position.z
);
const visualPlayerTarget = visualPlayerPosition.clone();

const LOCAL_POSITION_SMOOTHING = 20;
const REMOTE_POSITION_SMOOTHING = 12;
const REMOTE_ROTATION_SMOOTHING = 15;

const keys = new Set();

addEventListener("keydown", event => {
	keys.add(event.code);
});

addEventListener("keyup", event => {
	keys.delete(event.code);
});

renderer.domElement.addEventListener("click", () => {
	renderer.domElement.requestPointerLock();
});

addEventListener("mousemove", event => {
	if (document.pointerLockElement !== renderer.domElement) return;

	applyLook(player, {
		movementX: event.movementX,
		movementY: event.movementY
	});
});

const entities = new Map();
let selfId;
let synchronized = false;
const onlinePlayerCount = document.querySelector("#entities");

function updateOnlinePlayerCount() {
	const ids = new Set(entities.keys());
	if (selfId !== undefined) ids.add(selfId);
	onlinePlayerCount.textContent = ids.size;
}

const geometry = new THREE.CapsuleGeometry(
	CAPSULE_RADIUS,
	CAPSULE_LENGTH,
	4,
	8
);

function copyPosition(target, source) {
	target.x = source.x;
	target.y = source.y;
	target.z = source.z;
}

function getDeltaPosition(a, b) {
	return {
		x: a.x - b.x,
		y: a.y - b.y,
		z: a.z - b.z
	};
}

function lengthSq3(value) {
	return value.x * value.x + value.y * value.y + value.z * value.z;
}

function createNameplate(name) {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	const fontSize = 48;
	const paddingX = 24;
	const paddingY = 12;

	ctx.font = `600 ${fontSize}px sans-serif`;

	const textWidth = ctx.measureText(name).width;
	canvas.width = Math.ceil(textWidth + paddingX * 2);
	canvas.height = fontSize + paddingY * 2;
	ctx.font = `600 ${fontSize}px sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
	ctx.beginPath();
	ctx.roundRect(0, 0, canvas.width, canvas.height, 16);
	ctx.fill();
	ctx.fillStyle = "white";
	ctx.fillText(
		name,
		canvas.width / 2,
		canvas.height / 2
	);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;

	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthTest: false
	});

	const sprite = new THREE.Sprite(material);
	const height = 0.45;
	sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
	sprite.position.set(0, CAPSULE_LENGTH / 2 + CAPSULE_RADIUS + 0.45, 0);
	return sprite;
}

function upsert(data, snap = false) {
	const isSelf = data.id === selfId;

	if (isSelf) {
		if (snap) {
			player.position.x = data.x;
			player.position.y = data.y;
			player.position.z = data.z;

			player.pitch = data.pitch ?? player.pitch;
			player.yaw = data.yaw ?? player.yaw;

			copyPosition(sent.position, player.position);
			sent.pitch = player.pitch;
			sent.yaw = player.yaw;

			if (!synchronized) {
				visualPlayerPosition.set(
					player.position.x,
					player.position.y,
					player.position.z
				);
			}
		} else {
			player.position.x += data.dx ?? 0;
			player.position.y += data.dy ?? 0;
			player.position.z += data.dz ?? 0;

			player.pitch += data.dPitch ?? 0;
			player.yaw += data.dYaw ?? 0;

			copyPosition(sent.position, player.position);
			sent.pitch = player.pitch;
			sent.yaw = player.yaw;
		}

		return;
	}

	let entity = entities.get(data.id);
	const isNew = !entity;

	if (!entity) {
		const mesh = new THREE.Mesh(
			geometry,
			new THREE.MeshStandardMaterial({
				color: 0x2563eb
			})
		);

		const name = `Player ${data.id}`;
		const nameplate = createNameplate(name);
		mesh.add(nameplate);

		entity = {
			mesh,
			nameplate,
			name,
			target: new THREE.Vector3(),
			yaw: 0
		};

		entities.set(data.id, entity);
		scene.add(entity.mesh);
	}

	if (snap) {
		entity.target.set(data.x, data.y, data.z);
		entity.yaw = data.yaw ?? 0;
	} else {
		entity.target.add(
			new THREE.Vector3(
				data.dx ?? 0,
				data.dy ?? 0,
				data.dz ?? 0
			)
		);

		entity.yaw += data.dYaw ?? 0;
	}

	if (isNew) {
		entity.mesh.position.set(
			entity.target.x,
			entity.target.y + CAPSULE_CENTER_Y,
			entity.target.z
		);
		entity.mesh.rotation.y = entity.yaw;
	}

	updateOnlinePlayerCount();
}

const sent = {
	position: {
		x: player.position.x,
		y: player.position.y,
		z: player.position.z
	},
	pitch: player.pitch,
	yaw: player.yaw,
	still: 0
};

ws.on("entitySnapshot", snapshot => {
	const ids = new Set(snapshot.map(value => value.id));

	snapshot.forEach(value => {
		upsert(value, true);
	});

	for (const [id, entity] of entities) {
		if (!ids.has(id)) {
			scene.remove(entity.mesh);
			entities.delete(id);
		}
	}

	updateOnlinePlayerCount();
	if (snapshot.some(value => value.id === selfId)) synchronized = true;
});

ws.on("entity.move", upsert);
ws.on("entity.look", upsert);
ws.on("entity.both", upsert);

ws.on("entity.remove", ({ id }) => {
	const entity = entities.get(id);

	if (entity) {
		scene.remove(entity.mesh);
	}

	entities.delete(id);
	updateOnlinePlayerCount();
});

ws.on("selfEntity", id => {
	selfId = id;
	updateOnlinePlayerCount();
});

ws.on("pointsInfo", value => {
	document.querySelector("#points").textContent = value;
});

ws.on_reconnecting(() => {
	synchronized = false;
	keys.clear();
});

ws.on_reconnect(() => {
	synchronized = false;
	physicsAccumulatorMs = 0;
	lastPhysicsTime = performance.now();
});

ws.on_recovered(() => synchronized = false);

document.querySelector("#click").onclick = () => {
	ws.sendReliable("click");
};

let lastPhysicsTime = performance.now();
let physicsAccumulatorMs = 0;

function runPhysicsTick() {
	if (!synchronized) return;

	stepPlayer(player, {
		keys: {
			W: keys.has("KeyW"),
			A: keys.has("KeyA"),
			S: keys.has("KeyS"),
			D: keys.has("KeyD"),
		},
		dt: FIXED_DT_SECONDS
	});

	const delta = getDeltaPosition(player.position, sent.position);

	const dPitch = player.pitch - sent.pitch;
	const dYaw = player.yaw - sent.yaw;

	const moved = lengthSq3(delta) > 0;
	const looked = dPitch !== 0 || dYaw !== 0;

	if (moved || looked) {
		const lookValue = {
			dPitch,
			dYaw
		};

		const W = keys.has("KeyW") && !keys.has("KeyS"),
			  A = keys.has("KeyA") && !keys.has("KeyD"),
			  S = keys.has("KeyS") && !keys.has("KeyW"),
			  D = keys.has("KeyD") && !keys.has("KeyA");
		const permutation = { W, A, S, D, LOOK: looked && !(W || A || S || D) };

		if (looked) ws.sendPermutation("movement", permutation, lookValue);
		else ws.sendPermutation("movement", permutation);

		copyPosition(sent.position, player.position);
		sent.pitch = player.pitch;
		sent.yaw = player.yaw;
		sent.still = Date.now();
	} else if (Date.now() - sent.still > 1000) {
		ws.sendReliable("movement");
		sent.still = Date.now();
	}
}

function physicsLoop() {
	const now = performance.now();
	const elapsedMs = now - lastPhysicsTime;
	lastPhysicsTime = now;

	physicsAccumulatorMs += elapsedMs;

	let ticksRun = 0;

	while (
		physicsAccumulatorMs >= FIXED_DT_MS &&
		ticksRun < MAX_CATCH_UP_TICKS
	) {
		runPhysicsTick();
		physicsAccumulatorMs -= FIXED_DT_MS;
		ticksRun++;
	}

	if (
		ticksRun === MAX_CATCH_UP_TICKS &&
		physicsAccumulatorMs >= FIXED_DT_MS
	) {
		physicsAccumulatorMs %= FIXED_DT_MS;
	}

	const delay = FIXED_DT_MS - physicsAccumulatorMs;

	setTimeout(physicsLoop, delay);
}

let lastRenderTime = performance.now();

function renderFrame(now) {
	const deltaSeconds = Math.min((now - lastRenderTime) / 1000, 0.1);
	lastRenderTime = now;

	const localAlpha = 1 - Math.exp(-LOCAL_POSITION_SMOOTHING * deltaSeconds);
	visualPlayerTarget.set(player.position.x, player.position.y, player.position.z);
	visualPlayerPosition.lerp(visualPlayerTarget, localAlpha);

	camera.position.copy(visualPlayerPosition);
	camera.position.y += EYE_HEIGHT;

	camera.rotation.set(
		player.pitch,
		player.yaw,
		0,
		"YXZ"
	);

	const remotePositionAlpha = 1 - Math.exp(-REMOTE_POSITION_SMOOTHING * deltaSeconds);
	const remoteRotationAlpha = 1 - Math.exp(-REMOTE_ROTATION_SMOOTHING * deltaSeconds);

	for (const entity of entities.values()) {
		entity.mesh.position.x = THREE.MathUtils.lerp(
			entity.mesh.position.x,
			entity.target.x,
			remotePositionAlpha
		);
		entity.mesh.position.y = THREE.MathUtils.lerp(
			entity.mesh.position.y,
			entity.target.y + CAPSULE_CENTER_Y,
			remotePositionAlpha
		);
		entity.mesh.position.z = THREE.MathUtils.lerp(
			entity.mesh.position.z,
			entity.target.z,
			remotePositionAlpha
		);
		entity.mesh.rotation.y = THREE.MathUtils.lerp(
			entity.mesh.rotation.y,
			entity.yaw,
			remoteRotationAlpha
		);
	}

	renderer.render(scene, camera);
	requestAnimationFrame(renderFrame);
}

const playerPositions = document.querySelector("#player-positions");

function updatePlayerPositions() {
	const players = [{
		id: selfId,
		name: `Player ${selfId} (you)`,
		position: player.position
	}];

	for (const [id, entity] of entities) {
		players.push({ id, name: entity.name, position: entity.target });
	}

	players.sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity));
	playerPositions.replaceChildren(...players
		.filter(value => value.id !== undefined)
		.map(value => {
			const item = document.createElement("li");
			const { x, y, z } = value.position;
			item.textContent = `${value.name}: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
			return item;
		}));

	updateOnlinePlayerCount();
}

setInterval(updatePlayerPositions, 100);

setTimeout(physicsLoop, FIXED_DT_MS);
requestAnimationFrame(renderFrame);

addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});
