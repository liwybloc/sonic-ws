import * as THREE from "/vendor/three/three.module.js";

const ws = await SonicWS.connect(`ws://${location.host}`, {
	reconnect: {
		enabled: true,
		attempts: Infinity,
		minDelayMs: 250,
		maxDelayMs: 5000
	},
});
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .1, 1000);
const renderer = new THREE.WebGLRenderer({
	antialias: true
});
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x335533, 2));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({
	color: 0x3f8f3f
}));
ground.rotation.x = -Math.PI / 2;
scene.add(ground, new THREE.GridHelper(200, 200));

const player = {
	position: new THREE.Vector3(0, 1.7, 5),
	pitch: 0,
	yaw: 0
};
const keys = new Set();
addEventListener("keydown", event => keys.add(event.code));
addEventListener("keyup", event => keys.delete(event.code));
renderer.domElement.addEventListener("click", () => renderer.domElement.requestPointerLock());
addEventListener("mousemove", event => {
	if (document.pointerLockElement !== renderer.domElement) return;
	player.yaw -= event.movementX * .002;
	player.pitch = THREE.MathUtils.clamp(player.pitch - event.movementY * .002, -1.56, 1.56);
});

const entities = new Map();
let selfId;
const geometry = new THREE.CapsuleGeometry(.45, 1.1, 4, 8);

function upsert(data, snap = false) {
	if (data.id === selfId) return;
	let entity = entities.get(data.id);
	if (!entity) {
		entity = {
			mesh: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
				color: 0x2563eb
			})),
			target: new THREE.Vector3()
		};
		entities.set(data.id, entity);
		scene.add(entity.mesh);
	}
	if (snap) entity.target.set(data.x, data.y, data.z);
	else entity.target.add(new THREE.Vector3(data.dx ?? 0, data.dy ?? 0, data.dz ?? 0));
	entity.yaw = (snap ? data.yaw : entity.yaw + (data.dYaw ?? 0)) || 0;
	document.querySelector("#entities").textContent = entities.size;
}

ws.on("selfEntity", data => {
	selfId = data.id;
	player.position.set(data.x, data.y, data.z);
	player.pitch = data.pitch;
	player.yaw = data.yaw;
});
ws.on("entitySnapshot", snapshot => {
	const ids = new Set(snapshot.map(value => value.id));
	snapshot.forEach(value => upsert(value, true));
	for (const [id, entity] of entities)
		if (!ids.has(id)) {
			scene.remove(entity.mesh);
			entities.delete(id);
		}
});
ws.on("entity.move", data => upsert(data));
ws.on("entity.look", data => upsert(data));
ws.on("entity.both", data => upsert(data));
ws.on("entity.remove", ({
	id
}) => {
	const entity = entities.get(id);
	if (entity) scene.remove(entity.mesh);
	entities.delete(id);
});
ws.on("pointsInfo", value => document.querySelector("#points").textContent = value);
document.querySelector("#click").onclick = () => ws.sendReliable("click");

const sent = {
	position: player.position.clone(),
	pitch: 0,
	yaw: 0,
	still: 0
};
setInterval(() => {
	const delta = player.position.clone().sub(sent.position);
	const dPitch = player.pitch - sent.pitch,
		dYaw = player.yaw - sent.yaw;
	const moved = delta.lengthSq() > 0,
		looked = dPitch !== 0 || dYaw !== 0;
	if (moved || looked) {
		const value = {
			dx: delta.x,
			dy: delta.y,
			dz: delta.z,
			dPitch,
			dYaw
		};
		ws.sendVolatile(`movement.${moved && looked ? "both" : moved ? "move" : "look"}`, value);
		sent.position.copy(player.position);
		sent.pitch = player.pitch;
		sent.yaw = player.yaw;
		sent.still = Date.now();
	} else if (Date.now() - sent.still > 1000) {
		ws.sendVolatile("movement");
		sent.still = Date.now();
	}
}, 50);

let previous = performance.now();

function frame(now) {
	const dt = Math.min((now - previous) / 1000, .1);
	previous = now;
	const movement = new THREE.Vector3(Number(keys.has("KeyD")) - Number(keys.has("KeyA")), 0, Number(keys.has("KeyS")) - Number(keys.has("KeyW")));
	if (movement.lengthSq()) movement.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).multiplyScalar((keys.has("ShiftLeft") ? 12 : 7) * dt);
	player.position.add(movement);
	camera.position.copy(player.position);
	camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
	for (const entity of entities.values()) {
		entity.mesh.position.lerp(entity.target, 1 - Math.pow(.0001, dt));
		entity.mesh.rotation.y = entity.yaw;
	}
	renderer.render(scene, camera);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});