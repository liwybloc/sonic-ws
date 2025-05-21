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

    public serialize(): string {
        return String.fromCharCode(this.tag.length + 1) +      // tag length
               this.tag +                                      // tag
               String.fromCharCode(this.values.length + 1) +   // value count
               this.values.map(v =>                                    
                   String.fromCharCode(String(v).length + 1) + // value length
                   String.fromCharCode(getTypedIndex(v) + 1) + // value type
                   v                                           // value
               ).join("");
    }
}