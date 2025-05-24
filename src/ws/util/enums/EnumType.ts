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

import { processCharCodes } from "../packets/CompressionUtil";

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

export class EnumPackage {
    public tag: string;
    public values: EnumValue[];

    constructor(tag: string, values: any[]) {
        this.tag = tag;
        this.values = values;
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
}