/*
 * Copyright (c) 2026 Lily (liwybloc)
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

/** Utilities still required by schema serialization and the connection handshake. */
export const MAX_BYTE = 0xff;
export const MAX_USHORT = 0xffff;
export const MAX_UVARINT = (0x80 ** 7) - 1;
export const EMPTY_UINT8 = new Uint8Array([]);

export const compressBools = (values: boolean[]): number =>
    values.reduce((byte, value, index) => byte | (Number(value) << (7 - index)), 0);

export const decompressBools = (byte: number): boolean[] =>
    Array.from({ length: 8 }, (_, index) => (byte & (1 << (7 - index))) !== 0);

export function convertVarInt(value: number): number[] {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UVARINT)
        throw new Error(`Variable Ints must be within range 0 and ${MAX_UVARINT}: ${value}`);
    const result: number[] = [];
    do {
        let byte = value % 0x80;
        value = Math.floor(value / 0x80);
        if (value > 0) byte |= 0x80;
        result.push(byte);
    } while (value > 0);
    return result;
}

export function readVarInt(data: ArrayLike<number>, offset: number): [number, number] {
    let value = 0;
    let multiplier = 1;
    for (let sector = 0; sector < 8; sector++) {
        if (offset >= data.length) throw new Error("Truncated variable integer");
        const byte = data[offset++];
        value += (byte & 0x7f) * multiplier;
        if ((byte & 0x80) === 0) return [offset, value];
        multiplier *= 0x80;
    }
    throw new Error("Variable integer is too long");
}
