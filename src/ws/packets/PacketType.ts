/*
 * Copyright 2025 Lily (cutelittlelily)
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

    /** String data; use ENUMS if the values are constant  */
    STRINGS = 2,

    /** Constant primitive data; strings, numbers, booleans, null, undefined */
    ENUMS = 3,

    /** One or more bytes; -128 to 127 */
    BYTES = 4,
    /** One or more bytes; 0 to 255 */
    UBYTES = 5,
    /** One or more bytes; -128 to 127 | zig-zag encoded for small negatives (good for deltas; maps like -1->1, 1->2, -2->3, 2->4, etc.) */
    BYTES_ZZ = 6,

    /** One or more shorts; -32,768 to 32,767 */
    SHORTS = 7,
    /** One or more shorts; 0 to 65,535 */
    USHORTS = 8,
    /** One or more shorts; -32,768 to 32,767 | zig-zag encoded for small negatives (good for deltas; maps like -1->1, 1->2, -2->3, 2->4, etc.) */
    SHORTS_ZZ = 9,

    /** One or more integers up to MAX_SAFE_INTEGER | 9,007,199,254,740,991 (or negative). Similar maximum size will produce maximum efficiency */
    INTEGERS_D = 10,

    /** One or more integers of any size. */
    VARINT = 11,

    /** One or more single precision floating point numbers. Only up to 7 digits of accuracy. */
    FLOAT = 12,

    /** One or more true/false */
    BOOLEANS = 13,
    
}