import { convertVarInt, readVarInt } from "./CompressionUtil";
import { compressJSON, decompressJSON } from "./JSONUtil";

export const CONTROL_KEY = 0;
export enum ControlType { REQUEST = 1, RESPONSE = 2, REPLAY = 3, RESUME = 4, RESUMED = 5 }

export type ControlRequest = { type: ControlType.REQUEST; id: number; packetKey: number; payload: Uint8Array };
export type ControlResponse = { type: ControlType.RESPONSE; id: number; ok: boolean; value: any };
export type ControlReplay = { type: ControlType.REPLAY; sequence: number; payload: Uint8Array };
export type ControlResume = { type: ControlType.RESUME; sessionId: string; lastSequence: number };
export type ControlResumed = { type: ControlType.RESUMED; recovered: boolean; replayed: number };
export type ControlMessage = ControlRequest | ControlResponse | ControlReplay | ControlResume | ControlResumed;

export function encodeControlRequest(id: number, packetKey: number, payload: Uint8Array): Uint8Array {
    return Uint8Array.from([CONTROL_KEY, ControlType.REQUEST, ...convertVarInt(id), packetKey, ...payload]);
}

export function encodeControlResponse(id: number, ok: boolean, value: any): Uint8Array {
    return Uint8Array.from([CONTROL_KEY, ControlType.RESPONSE, ...convertVarInt(id), Number(ok), ...compressJSON(value)]);
}

export const encodeReplay = (sequence: number, payload: Uint8Array) =>
    Uint8Array.from([CONTROL_KEY, ControlType.REPLAY, ...convertVarInt(sequence), ...payload]);

export function encodeResume(sessionId: string, lastSequence: number): Uint8Array {
    const session = new TextEncoder().encode(sessionId);
    return Uint8Array.from([CONTROL_KEY, ControlType.RESUME, ...convertVarInt(session.length), ...session, ...convertVarInt(lastSequence)]);
}

export const encodeResumed = (recovered: boolean, replayed: number) =>
    Uint8Array.from([CONTROL_KEY, ControlType.RESUMED, Number(recovered), ...convertVarInt(replayed)]);

export function decodeControl(data: Uint8Array): ControlMessage {
    if (data[0] !== CONTROL_KEY || data.length < 3) {
        throw new Error("Invalid SonicWS control frame");
    }

    const type = data[1];

    switch (type) {
        case ControlType.REPLAY: {
            const [offset, sequence] = readVarInt(data, 2);
            return { type, sequence, payload: data.slice(offset) };
        }

        case ControlType.RESUME: {
            const [sessionOffset, length] = readVarInt(data, 2);
            const end = sessionOffset + length;

            if (end > data.length) {
                throw new Error("Recovery frame has an invalid session id");
            }

            const [_, lastSequence] = readVarInt(data, end);

            return {
                type,
                sessionId: new TextDecoder().decode(data.slice(sessionOffset, end)),
                lastSequence,
            };
        }

        case ControlType.RESUMED: {
            if (data.length < 4) {
                throw new Error("Invalid recovery result frame");
            }

            const [_, replayed] = readVarInt(data, 3);

            return {
                type,
                recovered: data[2] !== 0,
                replayed,
            };
        }

        case ControlType.REQUEST: {
            const [offset, id] = readVarInt(data, 2);

            if (offset >= data.length) {
                throw new Error("RPC request is missing its packet key");
            }

            return {
                type,
                id,
                packetKey: data[offset],
                payload: data.slice(offset + 1),
            };
        }

        case ControlType.RESPONSE: {
            const [offset, id] = readVarInt(data, 2);

            if (offset >= data.length) {
                throw new Error("RPC response is missing its status");
            }

            return {
                type,
                id,
                ok: data[offset] !== 0,
                value: decompressJSON(data.slice(offset + 1)),
            };
        }

        default:
            throw new Error(`Unknown SonicWS control frame type: ${type}`);
    }
}