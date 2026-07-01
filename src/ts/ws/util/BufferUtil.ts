/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

type BuildTuple<T, L extends number, R extends unknown[] = []> = 
    R['length'] extends L ? R : BuildTuple<T, L, [T, ...R]>;
export function splitArray<T, N extends number>(arr: T[], size: N): Array<BuildTuple<T, N>> {
    const result: Array<BuildTuple<T, N>> = [];
    for (let i = 0; i < arr.length; i += size) {
        const chunk = arr.slice(i, i + size) as BuildTuple<T, N>;
        result.push(chunk);
    }
    return result;
}

export function toPacketBuffer(code: number, data: Uint8Array): Uint8Array {
    const buffer = new Uint8Array(1 + data.length);
    buffer[0] = code;
    buffer.set(data, 1);
    return buffer;
}
export function splitBuffer(arr: Uint8Array, x: number): number[][] {
    return splitArray(Array.from(arr), x) as number[][];
}

export function stringifyBuffer(data: Uint8Array): string {
    const contents = Array.from(data).map(n => n.toString(16).padStart(2, "0")).join(" ");
    return `<Buffer ${contents}>`;
}