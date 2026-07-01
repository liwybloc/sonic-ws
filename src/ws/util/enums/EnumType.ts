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

import { processCharCodes } from "../StringUtil";
import { WrapEnum } from "./EnumHandler";

const TYPE_INDEX_MAP: Record<string, number> = { 
    'string': 0,
    'number': 1,
    'boolean': 2,
    'undefined': 3,
    'object': 4, // to handle null bug
};
export const TYPE_CONVERSION_MAP: Record<number, (data: string) => string | number | boolean | undefined | null> = {
    0: (d) => d,
    1: (d) => parseFloat(d),
    2: (d) => d == 'true',
    3: () => undefined,
    4: () => null,
}

function getTypedIndex(data: any) {
    const type = typeof data;
    if(!(type in TYPE_INDEX_MAP) && data != null) throw new Error(`Cannot serialize type "${type}" in an enum!`);
    return TYPE_INDEX_MAP[type];
}

export type EnumValue = string | number | boolean | undefined | null;

/** @internal */
export class EnumPackage {
    public tag: string;
    public values: EnumValue[] | readonly EnumValue[];

    constructor(tag: string, values: any[] | readonly any[]) {
        this.tag = tag;
        this.values = values;

        this.wrap = this.wrap.bind(this);
    }

    public serialize(): number[] {
        const tag = processCharCodes(this.tag);
        return [
                this.tag.length,                   // tag length
                ...tag,                            // tag
                this.values.length,                // value count
                ...this.values.map(v => [                                
                    String(v).length,              // value length
                    getTypedIndex(v),              // value type
                    ...processCharCodes(String(v)) // value
                ]).flat(),
               ];
    }

    /**
     * Wraps a value with this enum package
     * @param value Value to wrap
     * @returns Network encoded value
     */
    public wrap(value: any): number {
        return WrapEnum(this.tag, value);
    }

}