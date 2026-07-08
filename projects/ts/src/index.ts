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
export type { SerializedPacketOptions, SonicServerOptions, SonicServerSettings } from './ws/server/SonicWSServer';
export { PacketType } from './ws/packets/PacketType';
export { BasicMiddleware, ConnectionMiddleware, ServerMiddleware, BCInfo } from './ws/PacketProcessor';
export { CreatePacket, CreateObjPacket, CreateEnumPacket, CreatePacketGroup, DefinePackets, FlattenData, UnFlattenData } from './ws/util/packets/PacketUtils';
export type { SonicPacketTypeMap, SonicPacketTypeEntry, SonicProtocolTypes } from './ws/util/packets/PacketUtils';
export { VariantPermutation } from './ws/util/packets/VariantPermutation';
export { CreatePacketManifest, LoadPacketManifest } from './ws/util/packets/metadata/PacketManifest';
export type { PacketManifest } from './ws/util/packets/metadata/PacketManifest';
export { ValidatePacketSchema, AssertPacketSchema } from './ws/util/packets/metadata/SchemaValidation';
export type { SchemaValidationResult } from './ws/util/packets/metadata/SchemaValidation';
export { PacketLogger } from './ws/debug/PacketLogger';
export type { PacketLogEntry, PacketLoggerOptions } from './ws/debug/PacketLogger';
export { SonicMetrics } from './ws/debug/Metrics';
export type { PacketMetric, SonicMetricsSnapshot } from './ws/debug/Metrics';
export { RegisterPacketConstructor, UnregisterPacketConstructor } from './ws/util/packets/metadata/ConstructorRegistry';
export type { PacketConstructor } from './ws/util/packets/metadata/ConstructorRegistry';
export type { SonicWSAdapter, AdapterBroadcast } from './ws/server/Adapter';
export { DefineEnum, WrapEnum } from './ws/util/enums/EnumHandler';
export { initializeWasmCore } from './native/wrapper';
