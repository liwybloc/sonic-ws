export const FIXED_DT_MS = 50;
export const FIXED_DT_SECONDS = FIXED_DT_MS / 1000;

export const MAX_CATCH_UP_TICKS = 20;

export const EYE_HEIGHT = 1.7;

export const CAPSULE_RADIUS = 0.45;
export const CAPSULE_LENGTH = 1.1;
export const CAPSULE_CENTER_Y = CAPSULE_LENGTH / 2 + CAPSULE_RADIUS;

export const WALK_SPEED = 7;

export const MOUSE_SENSITIVITY = 0.002;
export const MIN_PITCH = -1.56;
export const MAX_PITCH = 1.56;

export const MAX_DT = 0.1;

export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export function clampPitch(pitch) {
	return clamp(pitch, MIN_PITCH, MAX_PITCH);
}

export function getMovementInput(keys) {
	const x = keys.D - keys.A;
	const z = keys.S - keys.W;

	const lengthSq = x * x + z * z;

	if (!lengthSq) {
		return { x: 0, z: 0 };
	}

	const length = Math.sqrt(lengthSq);

	return {
		x: x / length,
		z: z / length
	};
}

export function rotateMovementByYaw(input, yaw) {
	const cos = Math.cos(yaw);
	const sin = Math.sin(yaw);

	return {
		x: input.x * cos + input.z * sin,
		z: -input.x * sin + input.z * cos
	};
}

export function computeMovementDelta({
	keys,
	yaw,
	dt = FIXED_DT_SECONDS
}) {
	const safeDt = Math.min(dt, MAX_DT);
	const input = getMovementInput(keys);

	if (!input.x && !input.z) {
		return { dx: 0, dy: 0, dz: 0 };
	}

	const world = rotateMovementByYaw(input, yaw);
	const speed = WALK_SPEED;

	return {
		dx: world.x * speed * safeDt,
		dy: 0,
		dz: world.z * speed * safeDt
	};
}

export function stepPlayer(player, {
	keys,
	dt = FIXED_DT_SECONDS
}) {
	const delta = computeMovementDelta({
		keys,
		yaw: player.yaw,
		dt
	});

	player.position.x += delta.dx;
	player.position.y += delta.dy;
	player.position.z += delta.dz;

	return delta;
}

export function applyLook(player, {
	movementX,
	movementY
}) {
	player.yaw -= movementX * MOUSE_SENSITIVITY;
	player.pitch = clampPitch(player.pitch - movementY * MOUSE_SENSITIVITY);
}

export function applyDelta(position, delta) {
	position.x += delta.dx ?? 0;
	position.y += delta.dy ?? 0;
	position.z += delta.dz ?? 0;
}
