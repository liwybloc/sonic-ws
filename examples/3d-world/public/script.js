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

const geometry = new THREE.CapsuleGeometry(
	CAPSULE_RADIUS,
	CAPSULE_LENGTH,
	4,
	8
);

function toVector3(position) {
	return new THREE.Vector3(position.x, position.y, position.z);
}

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

function upsert(data, snap = false) {
	const isSelf = data.id === selfId;

	if (isSelf) {
		if(receivedSnapshot) return;
		if (snap) {
			player.position.x = data.x;
			player.position.y = data.y;
			player.position.z = data.z;

			player.pitch = data.pitch ?? player.pitch;
			player.yaw = data.yaw ?? player.yaw;

			copyPosition(sent.position, player.position);
			sent.pitch = player.pitch;
			sent.yaw = player.yaw;
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

	if (!entity) {
		entity = {
			mesh: new THREE.Mesh(
				geometry,
				new THREE.MeshStandardMaterial({
					color: 0x2563eb
				})
			),
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

	document.querySelector("#entities").textContent = entities.size;
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

let receivedSnapshot = false;

ws.on_ready(() => {
	receivedSnapshot = false;
});

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

	document.querySelector("#entities").textContent = entities.size;
	receivedSnapshot = true;
});

ws.on("entity.move", data => {
	upsert(data);
});

ws.on("entity.look", data => {
	upsert(data);
});

ws.on("entity.both", data => {
	upsert(data);
});

ws.on("entity.remove", ({ id }) => {
	const entity = entities.get(id);

	if (entity) {
		scene.remove(entity.mesh);
	}

	entities.delete(id);
	document.querySelector("#entities").textContent = entities.size;
});

ws.on("selfEntity", id => {
	selfId = id;
})

ws.on("pointsInfo", value => {
	document.querySelector("#points").textContent = value;
});

document.querySelector("#click").onclick = () => {
	ws.sendReliable("click");
};

let lastPhysicsTime = performance.now();
let physicsAccumulatorMs = 0;

function runPhysicsTick() {

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

function renderFrame() {
	console.log(player.position, player.pitch, player.yaw);
	camera.position.copy(toVector3(player.position));
	camera.position.y += EYE_HEIGHT;

	camera.rotation.set(
		player.pitch,
		player.yaw,
		0,
		"YXZ"
	);

	for (const entity of entities.values()) {
		const visualTarget = entity.target.clone();
		visualTarget.y += CAPSULE_CENTER_Y;

		entity.mesh.position.lerp(
			visualTarget,
			1 - Math.pow(0.0001, FIXED_DT_SECONDS)
		);

		entity.mesh.rotation.y = entity.yaw;
	}

	renderer.render(scene, camera);
	requestAnimationFrame(renderFrame);
}

setTimeout(physicsLoop, FIXED_DT_MS);
requestAnimationFrame(renderFrame);

addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});
