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

import { MAX_BYTE } from "../packets/CompressionUtil";
import { EnumPackage } from "./EnumType";

export const MAX_ENUM_SIZE = MAX_BYTE;

export const ENUM_TAG_TO_KEY: Record<string, Record<any, number>> = {};
export const ENUM_KEY_TO_TAG: Record<string, Record<number, any>> = {};

export const SET_PACKAGES: Record<string, EnumPackage> = {};

/**
 * Defines an enum with its tag and values
 * @param tag The tag of the enum; used for WrapEnum(tag, ...)
 * @param values The possible values of the enum
 * @returns A packaged enum
 */
export function DefineEnum(tag: string, values: any[] | readonly any[]): EnumPackage {
    const setPkg = SET_PACKAGES[tag];
    if(setPkg) {
        if(setPkg.values.find((n, i) => values[i] != n)) throw new Error(`Pre-existing enum package of tag '${tag}' is set and different!`);
        return setPkg;
    }
    if(values.length > MAX_ENUM_SIZE) throw new Error(`An enum can only hold ${MAX_ENUM_SIZE} possible values.`);
    ENUM_TAG_TO_KEY[tag] = Object.fromEntries(values.map((v, i) => [v, i]));
    ENUM_KEY_TO_TAG[tag] = Object.fromEntries(values.map((v, i) => [i, v]));
    return SET_PACKAGES[tag] = new EnumPackage(tag, values);
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

export function DeWrapEnum(tag: string, value: number): any {
    return ENUM_KEY_TO_TAG[tag][value];
}