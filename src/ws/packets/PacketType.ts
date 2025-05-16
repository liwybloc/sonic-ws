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

    /** One or more integers from -27,648 to 27,647 */
    INTS_C = 4,
    /** One or more positive integers from 0 to 55,295 */
    UINTS_C = 5,
    /** One or more integers from -27,648 to 27,647, but zig-zag encoded for small negatives (good for deltas; maps like -1->1, 1->2, -2->3, 2->4, etc.) */
    ZIG_ZAG = 6,

    /** One or more integers up to MAX_SAFE_INTEGER | 9,007,199,254,740,991 (or negative). Similar maximum size will produce maximum efficiency */
    INTS_D = 7,

    /** One or more integers up to MAX_SAFE_INTEGER | 9,007,199,2554,740,991 (or negative). More efficient for differently sized numbers, but worse than INTS_D for similar sized numbers. */
    INTS_A = 8,

    /** One or more numbers up to MAX_VALUE or 1.7976931348623157e+308. */
    EXPONENTIAL = 9,

    /** One or more numbers of any size */
    DECIMALS = 10,

    /** One or more true/false */
    BOOLEANS = 11,
    
}