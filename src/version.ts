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

import { processCharCodes } from "./ws/util/StringUtil";

/** Current protocol version */
export const VERSION = 10;
/** Server data suffix */
export const SERVER_SUFFIX = "SWS";
/** Server data suffix in array */
export const SERVER_SUFFIX_NUMS = processCharCodes(SERVER_SUFFIX);