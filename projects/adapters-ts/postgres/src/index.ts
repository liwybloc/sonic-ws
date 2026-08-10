import { deserialize, serialize } from "node:v8";

import {
    Client,
    type ClientConfig,
} from "pg";

import type {
    AdapterBroadcast,
    SonicWSAdapter,
} from "sonic-ws";

const DEFAULT_CHANNEL =
    "sonic_ws_broadcast";

const MAX_NOTIFY_PAYLOAD_BYTES =
    7_999;

export interface PostgresAdapterOptions {
    /**
     * PostgreSQL connection string.
     *
     * Example:
     * postgres://user:password@localhost:5432/database
     */
    connectionString?: string;

    /**
     * PostgreSQL LISTEN/NOTIFY channel used by SonicWS servers.
     *
     * All servers that should communicate with each other
     * must use the same channel.
     *
     * @default "sonic_ws_broadcast"
     */
    channel?: string;

    /**
     * Maximum encoded payload size accepted by the adapter.
     *
     * PostgreSQL NOTIFY payloads must be smaller than 8000 bytes
     * with the default PostgreSQL configuration.
     *
     * @default 7999
     */
    maxPayloadBytes?: number;

    /**
     * Additional node-postgres client options.
     */
    postgres?: ClientConfig;
}

export class PostgresAdapter implements SonicWSAdapter {
    private readonly publisher: Client;
    private readonly subscriber: Client;

    private readonly channel: string;
    private readonly maxPayloadBytes: number;

    private receiver?: (
        message: AdapterBroadcast
    ) => void | Promise<void>;

    private startPromise?: Promise<void>;

    private publisherConnected = false;
    private subscriberConnected = false;

    private closed = false;

    public constructor(
        options: PostgresAdapterOptions = {}
    ) {
        this.channel =
            options.channel ?? DEFAULT_CHANNEL;

        this.maxPayloadBytes =
            options.maxPayloadBytes ??
            MAX_NOTIFY_PAYLOAD_BYTES;

        if (
            Buffer.byteLength(
                this.channel,
                "utf8"
            ) === 0
        ) {
            throw new Error(
                "PostgreSQL adapter channel cannot be empty"
            );
        }

        if (
            !Number.isInteger(
                this.maxPayloadBytes
            ) ||
            this.maxPayloadBytes <= 0
        ) {
            throw new Error(
                "PostgreSQL adapter maxPayloadBytes must be a positive integer"
            );
        }

        const config: ClientConfig = {
            ...options.postgres,

            connectionString:
                options.connectionString ??
                options.postgres?.connectionString,
        };

        this.publisher =
            new Client(config);

        this.subscriber =
            new Client(config);

        this.publisher.on(
            "error",
            error => {
                if (this.closed) {
                    return;
                }

                console.error(
                    "[SonicWS PostgreSQL adapter] publisher error:",
                    error
                );
            }
        );

        this.subscriber.on(
            "error",
            error => {
                if (this.closed) {
                    return;
                }

                console.error(
                    "[SonicWS PostgreSQL adapter] subscriber error:",
                    error
                );
            }
        );

        this.publisher.on(
            "end",
            () => {
                this.publisherConnected = false;
            }
        );

        this.subscriber.on(
            "end",
            () => {
                this.subscriberConnected = false;
            }
        );
    }

    public start(
        _serverId: string,
        receiver: (
            message: AdapterBroadcast
        ) => void | Promise<void>
    ): Promise<void> {
        if (this.closed) {
            return Promise.reject(
                new Error(
                    "Cannot start a closed PostgreSQL adapter"
                )
            );
        }

        this.receiver = receiver;

        if (!this.startPromise) {
            this.startPromise =
                this.initialize();
        }

        return this.startPromise;
    }

    private async initialize(): Promise<void> {
        try {
            await Promise.all([
                this.publisher
                    .connect()
                    .then(() => {
                        this.publisherConnected =
                            true;
                    }),

                this.subscriber
                    .connect()
                    .then(() => {
                        this.subscriberConnected =
                            true;
                    }),
            ]);

            this.subscriber.on(
                "notification",
                notification => {
                    if (
                        notification.channel !==
                        this.channel
                    ) {
                        return;
                    }

                    if (
                        notification.payload ===
                        undefined
                    ) {
                        return;
                    }

                    void this.handleNotification(
                        notification.payload
                    );
                }
            );

            await this.subscriber.query(
                `LISTEN ${quoteIdentifier(
                    this.channel
                )}`
            );
        }
        catch (error) {
            await this.closeClients();

            throw error;
        }
    }

    private async handleNotification(
        payload: string
    ): Promise<void> {
        try {
            const message =
                deserialize(
                    Buffer.from(
                        payload,
                        "base64"
                    )
                ) as AdapterBroadcast;

            await this.receiver?.(
                message
            );
        }
        catch (error) {
            console.error(
                "[SonicWS PostgreSQL adapter] failed to process message:",
                error
            );
        }
    }

    public async publish(
        message: AdapterBroadcast
    ): Promise<void> {
        if (this.closed) {
            throw new Error(
                "Cannot publish using a closed PostgreSQL adapter"
            );
        }

        if (!this.startPromise) {
            throw new Error(
                "PostgreSQL adapter has not been started"
            );
        }

        await this.startPromise;

        const payload =
            serialize(message)
                .toString("base64");

        const payloadBytes =
            Buffer.byteLength(
                payload,
                "utf8"
            );

        if (
            payloadBytes >
            this.maxPayloadBytes
        ) {
            throw new Error(
                `PostgreSQL adapter payload is ${payloadBytes} bytes, exceeding the configured ${this.maxPayloadBytes} byte limit`
            );
        }

        await this.publisher.query(
            "SELECT pg_notify($1, $2)",
            [
                this.channel,
                payload,
            ]
        );
    }

    // membership stays local
    public join(
        _connectionId: number,
        _room: string
    ): void { }

    // membership stays local
    public leave(
        _connectionId: number,
        _room: string
    ): void { }

    // membership stays local
    public disconnect(
        _connectionId: number
    ): void { }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.closed = true;

        if (this.startPromise) {
            await Promise.allSettled([
                this.startPromise,
            ]);
        }

        await this.closeClients();
    }

    private async closeClients():
        Promise<void>
    {
        const tasks:
            Promise<void>[] = [];

        if (this.subscriberConnected) {
            tasks.push(
                this.subscriber.end()
            );
        }

        if (this.publisherConnected) {
            tasks.push(
                this.publisher.end()
            );
        }

        await Promise.allSettled(
            tasks
        );

        this.subscriberConnected =
            false;

        this.publisherConnected =
            false;
    }
}

function quoteIdentifier(
    identifier: string
): string {
    return `"${identifier.replace(
        /"/g,
        "\"\""
    )}"`;
}

export function createPostgresAdapter(
    options?: PostgresAdapterOptions
): PostgresAdapter {
    return new PostgresAdapter(
        options
    );
}