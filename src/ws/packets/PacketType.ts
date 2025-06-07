/*
 * Copyright 2025 Lily (liwybloc)
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
    FLOAT = 12,

    /** One or more true/false */
    BOOLEANS = 13,
    
}