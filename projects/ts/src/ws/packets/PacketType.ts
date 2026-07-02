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

// separated file to allow imports

/** All different packet types. Use ENUMS for any constant primitive data */
export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw data */
    RAW = 1,

    /** 8 byte string data (0-255 codes) */
    STRINGS_ASCII = 2,
    /** Code point UTF16 data; up to 0x10FFFF */
    STRINGS_UTF16 = 3,

    /** Strings; defaults to ASCII (0-255 codes). Use STRINGS_UTF16 for more codes. */
    STRINGS = STRINGS_ASCII,

    /** Constant primitive data; strings, numbers, booleans, null, undefined */
    ENUMS = 4,

    /** One or more bytes; -128 to 127 | zig-zag encoded */
    BYTES = 5,
    /** One or more bytes; 0 to 255 */
    UBYTES = 6,

    /** One or more shorts; -32,768 to 32,767 | zig-zag encoded */
    SHORTS = 7,
    /** One or more shorts; 0 to 65,535 */
    USHORTS = 8,

    /** One or more integers between -281,474,976,710,656 and 281,474,976,710,655 | zig-zag encoded */
    VARINT = 9,
    /** One or more integers up to 562,949,953,421,311. */
    UVARINT = 10,
    /** Var ints that use deltas; each value will show the difference from the last value. Good for close numbers */
    DELTAS = 11,

    /** One or more single precision floating point numbers. Only up to 7 digits of accuracy. */
    FLOATS = 12,

    /** One or more double precision floating point numbers. */
    DOUBLES = 13,

    /** One or more true/false */
    BOOLEANS = 14,
    
    /** Consumes multiple keys to describe the value. E.g. if you want to send a boolean, this could take up 2 keys instead of sending 2 bytes. Currently W.I.P. */
    KEY_EFFECTIVE = 15,

    /** TypeScript-side JSONUtil codec carried as opaque RAW bytes through reserved wire type 16. */
    JSON = 16,

    /** Hex bytes, e.g. 0xFFFFFF - the result will always be returned in lowercase. This can only hold 1 hex string, since it's the same as UBYTES but auto-parses. */
    HEX = 17,
}
