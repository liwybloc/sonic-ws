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

import { processCharCodes } from "./ws/util/StringUtil";

/** Current protocol version */
export const VERSION = 25;
/** Server data suffix */
export const SERVER_SUFFIX = "SWS";
/** Server data suffix in array */
export const SERVER_SUFFIX_NUMS = processCharCodes(SERVER_SUFFIX);
