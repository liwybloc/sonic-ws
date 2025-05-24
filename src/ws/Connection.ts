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