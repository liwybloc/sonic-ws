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

import WS from 'ws';
import { SonicWSCore } from '../core/ClientCore';

/** Class to connect to a SonicWS server */
export class SonicWS extends SonicWSCore {
    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     */
    constructor(url: string, options?: WS.ClientOptions) {
        const ws = new WS.WebSocket(url, options);
        super(ws as unknown as WebSocket);
    }
}