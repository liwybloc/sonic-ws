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

import { MAX_BYTE } from "../packets/CompressionUtil";
import { EnumPackage } from "./EnumType";

export const MAX_ENUM_SIZE = MAX_BYTE;

export const ENUM_TAG_TO_KEY: Record<string, Record<any, number>> = {};
export const ENUM_KEY_TO_TAG: Record<string, Record<number, any>> = {};

/**
 * Defines an enum with its tag and values
 * @param tag The tag of the enum; used for WrapEnum(tag, ...)
 * @param values The possible values of the enum
 * @returns A packaged enum
 */
export function DefineEnum(tag: string, values: any[]): EnumPackage {
    if(values.length > MAX_ENUM_SIZE) throw new Error(`An enum can only hold ${MAX_ENUM_SIZE} possible values.`);
    ENUM_TAG_TO_KEY[tag] = Object.fromEntries(values.map((v, i) => [v, i]));
    ENUM_KEY_TO_TAG[tag] = Object.fromEntries(values.map((v, i) => [i, v]));
    return new EnumPackage(tag, values);
}

/**
 * Wraps an enum into a transmittable format
 * @param tag The tag of the enum
 * @param value The value to send
 * @returns A transmittable enum value
 */
export function WrapEnum(tag: string, value: any): number {
    if(!(value in ENUM_TAG_TO_KEY[tag])) throw new Error(`Value "${value}" does not exist in enum "${tag}"`);
    return ENUM_TAG_TO_KEY[tag][value];
}

export function fromIndex(tag: string, index: number): string {
    return ENUM_KEY_TO_TAG[tag][index];
}
export function fromEncoded(tag: string, encoded: string): string {
    return fromIndex(tag, encoded.charCodeAt(0));
}