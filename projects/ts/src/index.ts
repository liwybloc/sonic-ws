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

export { SonicWS } from './ws/client/node/ClientNode';
export type { SonicConnectOptions } from './ws/client/node/ClientNode';
export type { ReconnectOptions } from './ws/client/core/ClientCore';
export { SonicWSConnection } from './ws/server/SonicWSConnection';
export { SonicWSServer } from './ws/server/SonicWSServer';
export type { SonicServerOptions, SonicServerSettings } from './ws/server/SonicWSServer';
export { PacketType } from './ws/packets/PacketType';
export { BasicMiddleware, ConnectionMiddleware, ServerMiddleware, BCInfo } from './ws/PacketProcessor';
export { CreatePacket, CreateObjPacket, CreateEnumPacket, CreatePacketGroup, FlattenData, UnFlattenData } from './ws/util/packets/PacketUtils';
export { CreatePacketManifest, LoadPacketManifest } from './ws/util/packets/PacketManifest';
export type { PacketManifest } from './ws/util/packets/PacketManifest';
export { RegisterPacketConstructor, UnregisterPacketConstructor } from './ws/util/packets/ConstructorRegistry';
export type { PacketConstructor } from './ws/util/packets/ConstructorRegistry';
export type { SonicWSAdapter, AdapterBroadcast } from './ws/server/Adapter';
export { DefineEnum, WrapEnum } from './ws/util/enums/EnumHandler';
export { initializeWasmCore } from './native/wrapper';
