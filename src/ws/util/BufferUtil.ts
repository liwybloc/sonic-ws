/*
 * Copyright 2026 Lily (liwybloc)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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