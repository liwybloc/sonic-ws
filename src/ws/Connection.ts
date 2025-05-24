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

export interface Connection {
    
    timers: Record<number, number>;

    /** Sets an auto closing timer on the connection. Use connection.clearTimeout to prevent memory waste. */
    setTimeout(call: () => void, time: number): number;
    /** Sets an auto closing interval on the connection. Use connection.clearInterval to prevent memory waste. */
    setInterval(call: () => void, time: number): number;

    /** Safely clears a timer */
    clearTimeout(index: number): void;
    /** Safely clears an interval */
    clearInterval(index: number): void;

    /**
     * Sends the uint8array through the connection
     */
    raw_send(data: Uint8Array): void;

    /**
     * Closes the connection
     */
    close(code?: number, reason?: string): void;

}