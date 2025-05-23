export interface Connection {

    /** Sets an auto closing timer on the connection */
    setTimeout(call: () => void, time: number): number;
    /** Sets an auto closing interval on the connection */
    setInterval(call: () => void, time: number): number;

    /**
     * Sends the uint8array through the connection
     */
    raw_send(data: Uint8Array): void;

    /**
     * Closes the connection
     */
    close(code?: number, reason?: string): void;

}