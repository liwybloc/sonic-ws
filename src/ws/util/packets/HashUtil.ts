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

const HASH_INIT_64 = 14695981039346656037n;
const HASH_PRIME_64 = 1099511628211n;
const MASK_64 = (1n << 64n) - 1n;

const hashValue64 = (value: any): bigint => {
    let hash = HASH_INIT_64;

    const walk = (v: any): void => {
        if (v === null) {
            hash ^= 0n;
            hash = (hash * HASH_PRIME_64) & MASK_64;
            return;
        }

        const t = typeof v;

        if (t === "number") {
            hash ^= BigInt(Math.trunc(v));
            hash = (hash * HASH_PRIME_64) & MASK_64;
            return;
        }

        if (t === "string") {
            for (let i = 0; i < v.length; i++) {
                hash ^= BigInt(v.charCodeAt(i));
                hash = (hash * HASH_PRIME_64) & MASK_64;
            }
            return;
        }

        if (t === "boolean") {
            hash ^= v ? 1n : 0n;
            hash = (hash * HASH_PRIME_64) & MASK_64;
            return;
        }

        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
                walk(v[i]);
            }
            return;
        }

        if (t === "object") {
            const keys = Object.keys(v).sort();

            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];

                for (let j = 0; j < k.length; j++) {
                    hash ^= BigInt(k.charCodeAt(j));
                    hash = (hash * HASH_PRIME_64) & MASK_64;
                }

                walk(v[k]);
            }
        }
    };

    walk(value);
    return hash;
};

const HASH_INIT = 2166136261;

const hashValue32 = (value: any): number => {
    let hash = HASH_INIT;

    const walk = (v: any): void => {
        if (v === null) {
            hash ^= 0;
            return;
        }

        const t = typeof v;

        if (t === "number") {
            hash ^= v | 0;
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
            return;
        }

        if (t === "string") {
            for (let i = 0; i < v.length; i++) {
                hash ^= v.charCodeAt(i);
                hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
            }
            return;
        }

        if (t === "boolean") {
            hash ^= v ? 1 : 0;
            return;
        }

        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
                walk(v[i]);
            }
            return;
        }

        if (t === "object") {
            const keys = Object.keys(v).sort();

            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];

                for (let j = 0; j < k.length; j++) {
                    hash ^= k.charCodeAt(j);
                    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
                }

                walk(v[k]);
            }
        }
    };

    walk(value);
    return hash >>> 0;
};

let hashFunc: (value: any) => bigint | number = hashValue64;
export function setHashFunc(use64Bit: boolean): void {
    hashFunc = use64Bit ? hashValue64 : hashValue32;
}

export function hashValue(value: any): bigint | number {
    return hashFunc(value);
}

