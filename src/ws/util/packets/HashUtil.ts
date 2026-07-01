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

