/*
 * Copyright (c) 2026 Lily (liwybloc)
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

export function processCharCodes(text: string): number[] {
    return Array.from(text, character => character.codePointAt(0)!);
}

export function convertCharCodes(codes: number[]): string {
    return String.fromCodePoint(...codes);
}

export function as8String(data: Uint8Array): string {
    return convertCharCodes(Array.from(data));
}
