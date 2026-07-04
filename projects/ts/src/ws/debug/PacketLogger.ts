import type { ConnectionMiddleware } from "../PacketProcessor";

export type PacketLogEntry = {
    direction: "send" | "receive";
    tag: string;
    values: unknown;
    bytes: number;
    timestamp: number;
};

export type PacketLoggerOptions = {
    logger?: (entry: PacketLogEntry) => void;
    includeValues?: boolean;
};

/** Readable packet logging implemented through the public middleware hooks. */
export class PacketLogger implements ConnectionMiddleware {
    private readonly logger: (entry: PacketLogEntry) => void;
    private readonly includeValues: boolean;
    private readonly sends = new Map<string, unknown[]>();
    private readonly receiveSizes = new Map<string, number[]>();

    constructor(options: PacketLoggerOptions = {}) {
        this.includeValues = options.includeValues ?? true;
        this.logger = options.logger ?? (entry => {
            const arrow = entry.direction === "send" ? "→" : "←";
            console.debug(`${arrow} ${entry.tag}`, entry.values, `${entry.bytes} bytes`);
        });
    }

    onSend_pre = (tag: string, values: unknown[]): void => { this.sends.set(tag, values); };
    onSend_post = (tag: string, _data: Uint8Array, size: number): void => {
        this.emit("send", tag, this.sends.get(tag), size + 1);
        this.sends.delete(tag);
    };
    onReceive_pre = (tag: string, _data: Uint8Array, size: number): void => {
        const queue = this.receiveSizes.get(tag) ?? [];
        queue.push(size + 1);
        this.receiveSizes.set(tag, queue);
    };
    onReceive_post = (tag: string, values: unknown): void => {
        const queue = this.receiveSizes.get(tag);
        this.emit("receive", tag, values, queue?.shift() ?? 0);
        if (queue?.length === 0) this.receiveSizes.delete(tag);
    };
    private emit(direction: "send" | "receive", tag: string, values: unknown, bytes: number): void {
        this.logger({ direction, tag, values: this.includeValues ? values : undefined, bytes, timestamp: Date.now() });
    }
}
