export type AdapterBroadcast = {
    origin: string;
    room: string;
    packetTag: string;
    values: any[];
    exceptConnectionId?: number;
};

/** Cross-process room membership and broadcast contract. */
export interface SonicWSAdapter {
    start?(serverId: string, receiver: (message: AdapterBroadcast) => Promise<void>): void | Promise<void>;
    publish(message: AdapterBroadcast): void | Promise<void>;
    join(connectionId: number, room: string): void | Promise<void>;
    leave(connectionId: number, room: string): void | Promise<void>;
    disconnect(connectionId: number): void | Promise<void>;
    close?(): void | Promise<void>;
}
