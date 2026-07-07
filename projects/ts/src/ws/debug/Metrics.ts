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

import type { BCInfo, ConnectionMiddleware, ServerMiddleware } from "../PacketProcessor";
import type { SonicWSConnection } from "../server/SonicWSConnection";

export type PacketMetric = {
    packets: number;
    bytes: number;
};

export type SonicMetricsSnapshot = {
    sent: Record<string, PacketMetric>;
    received: Record<string, PacketMetric>;
    broadcasts: Record<string, PacketMetric>;
    closes: Record<string, number>;
    sendErrors: Record<string, number>;
    volatileDrops: Record<string, number>;
};

function emptyMetric(): PacketMetric {
    return { packets: 0, bytes: 0 };
}

function addMetric(target: Map<string, PacketMetric>, tag: string, bytes: number): void {
    const current = target.get(tag) ?? emptyMetric();

    current.packets++;
    current.bytes += bytes;

    target.set(tag, current);
}

function addCount(target: Map<string, number>, key: string): void {
    target.set(key, (target.get(key) ?? 0) + 1);
}

function metricRecord(source: Map<string, PacketMetric>): Record<string, PacketMetric> {
    return Object.fromEntries(
        [...source.entries()].map(([key, value]) => [key, { ...value }]),
    );
}

function countRecord(source: Map<string, number>): Record<string, number> {
    return Object.fromEntries(source.entries());
}

/**
 * Collects production-safe counters from SonicWS middleware hooks.
 *
 * Metrics are in-memory and intentionally simple. Install one collector on a
 * server, client, or connection when you need packet and byte counters without
 * parsing debug logs.
 */
export class SonicMetrics implements ConnectionMiddleware, ServerMiddleware {
    private sent = new Map<string, PacketMetric>();
    private received = new Map<string, PacketMetric>();
    private broadcasts = new Map<string, PacketMetric>();
    private closes = new Map<string, number>();
    private sendErrors = new Map<string, number>();
    private volatileDrops = new Map<string, number>();

    onSend_post = (tag: string, _data: Uint8Array, size: number): void => {
        addMetric(this.sent, tag, size + 1);
    };

    onReceive_pre = (tag: string, _data: Uint8Array, size: number): void => {
        addMetric(this.received, tag, size + 1);
    };

    onPacketBroadcast_post = (tag: string, _info: BCInfo, _data: Uint8Array, size: number): void => {
        addMetric(this.broadcasts, tag, size + 1);
    };

    onClientDisconnect = (_connection: SonicWSConnection, code: number): void => {
        addCount(this.closes, String(code));
    };

    /** Records a send error from an `onSendError` callback. */
    recordSendError(packetTag: string): void {
        addCount(this.sendErrors, packetTag);
    }

    /** Records a volatile send that was skipped because of backpressure. */
    recordVolatileDrop(packetTag: string): void {
        addCount(this.volatileDrops, packetTag);
    }

    /** Returns a copy of the current counters. */
    snapshot(): SonicMetricsSnapshot {
        return {
            sent: metricRecord(this.sent),
            received: metricRecord(this.received),
            broadcasts: metricRecord(this.broadcasts),
            closes: countRecord(this.closes),
            sendErrors: countRecord(this.sendErrors),
            volatileDrops: countRecord(this.volatileDrops),
        };
    }

    /** Clears all counters. */
    reset(): void {
        this.sent.clear();
        this.received.clear();
        this.broadcasts.clear();
        this.closes.clear();
        this.sendErrors.clear();
        this.volatileDrops.clear();
    }
}

