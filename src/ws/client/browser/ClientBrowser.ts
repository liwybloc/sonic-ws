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

import { WrapEnum } from "../../util/enums/EnumHandler";
import { FlattenData, UnFlattenData } from "../../util/packets/PacketUtils";
import { SonicWSCore } from "../core/ClientCore";

// Defines SonicWS class and gives the needed functions

const w = window as any;
w.SonicWS = class SonicWS extends SonicWSCore {
    constructor(url: string, protocols?: string | string[]) {
        const ws = new WebSocket(url, protocols);
        super(ws, async (val: MessageEvent) => new Uint8Array(await (val.data as Blob).arrayBuffer()));
    }

    WrapEnum(tag: string, value: string) {
        return WrapEnum(tag, value);
    }

    FlattenData(array: any[][]): any[] {
        return FlattenData(array);
    }

    UnFlattenData(array: any[]): any[][] {
        return UnFlattenData(array);
    }
}