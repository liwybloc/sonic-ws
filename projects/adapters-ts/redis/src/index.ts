import { deserialize, serialize } from "node:v8";

import {
    createClient,
    type RedisClientOptions,
} from "redis";

import type {
    AdapterBroadcast,
    SonicWSAdapter,
} from "sonic-ws";

type RedisClient = ReturnType<typeof createClient>;

export interface RedisAdapterOptions {
    /**
     * Redis connection URL.
     */
    url?: string;

    /**
     * Redis Pub/Sub channel used by SonicWS servers.
     *
     * All servers that should communicate with each other
     * must use the same channel.
     *
     * @default "sonic-ws:broadcast"
     */
    channel?: string;

    /**
     * Additional node-redis client options. Not sure if these are needed yet so I'll just include them...
     */
    redis?: RedisClientOptions;
}

export class RedisAdapter implements SonicWSAdapter {
    private readonly publisher: RedisClient;
    private readonly subscriber: RedisClient;

    private readonly channel: string;

    private receiver?: (
        message: AdapterBroadcast
    ) => void | Promise<void>;

    private startPromise?: Promise<void>;

    private closed = false;

    public constructor(
        options: RedisAdapterOptions = {}
    ) {
        this.channel =
            options.channel ?? "sonic-ws:broadcast";

        this.publisher = createClient({
            ...options.redis,
            url: options.url ?? options.redis?.url,
        });

        this.subscriber = this.publisher.duplicate();

        this.publisher.on("error", error => {
            console.error(
                "[SonicWS Redis adapter] publisher error:",
                error
            );
        });

        this.subscriber.on("error", error => {
            console.error(
                "[SonicWS Redis adapter] subscriber error:",
                error
            );
        });
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
                    "Cannot start a closed Redis adapter"
                )
            );
        }

        this.receiver = receiver;

        if (!this.startPromise) {
            this.startPromise = this.initialize();
        }

        return this.startPromise;
    }

    private async initialize(): Promise<void> {
        await Promise.all([
            this.publisher.connect(),
            this.subscriber.connect(),
        ]);

        await this.subscriber.subscribe(
            this.channel,
            async payload => {
                try {
                    const message =
                        deserialize(
                            Buffer.from(
                                payload,
                                "base64"
                            )
                        ) as AdapterBroadcast;

                    await this.receiver?.(message);
                }
                catch (error) {
                    console.error(
                        "[SonicWS Redis adapter] failed to process message:",
                        error
                    );
                }
            }
        );
    }

    public async publish(
        message: AdapterBroadcast
    ): Promise<void> {
        if (this.closed) {
            throw new Error(
                "Cannot publish using a closed Redis adapter"
            );
        }

        if (!this.startPromise) {
            throw new Error(
                "Redis adapter has not been started"
            );
        }

        await this.startPromise;

        const payload =
            serialize(message).toString("base64");

        await this.publisher.publish(
            this.channel,
            payload
        );
    }

    // membership is maintained locally by SonicWS so these aren't necessary
    public join(_connectionId: number, _room: string): void { }
    public leave(_connectionId: number, _room: string): void { }
    public disconnect(_connectionId: number): void { }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.closed = true;

        await Promise.allSettled([
            this.subscriber.isOpen
                ? this.subscriber.close()
                : Promise.resolve(),

            this.publisher.isOpen
                ? this.publisher.close()
                : Promise.resolve(),
        ]);
    }
}

export function createRedisAdapter(
    options?: RedisAdapterOptions
): RedisAdapter {
    return new RedisAdapter(options);
}