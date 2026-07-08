import {
    CreatePacket,
    DefinePackets,
    PacketType,
    SonicWS,
    SonicWSServer,
    type SonicProtocolTypes,
} from "../dist/index.js";

type Assert<T extends true> = T;

const clientPackets = DefinePackets([
    CreatePacket({ tag: "none", type: PacketType.NONE }),
    CreatePacket({ tag: "floats", type: PacketType.FLOATS }),
    CreatePacket({ tag: "bools", type: PacketType.BOOLEANS }),
    CreatePacket({ tag: "message", type: PacketType.STRINGS_UTF16 }),
    CreatePacket({
        tag: "movement.move",
        type: PacketType.VARINT,
        schema: ["dx", "dy", "dz"],
        dataMin: 3,
        dataMax: 3,
    }),
    CreatePacket({
        tag: "snapshot",
        type: PacketType.VARINT,
        schema: ["id", "x"],
        autoFlatten: true,
    }),
] as const);

const serverPackets = DefinePackets([
    CreatePacket({ tag: "points", type: PacketType.UVARINT }),
    CreatePacket({
        tag: "entity.remove",
        type: PacketType.VARINT,
        schema: ["id"],
        dataMin: 1,
        dataMax: 1,
    }),
] as const);

const server = new SonicWSServer({ clientPackets, serverPackets });

server.on_connect(ws => {
    ws.on("floats", value => {
        value.toFixed();

        // @ts-expect-error FLOATS listeners receive numbers, not strings.
        value.toUpperCase();
    });

    ws.on("bools", value => {
        const ok: boolean = value;
        void ok;

        // @ts-expect-error BOOLEANS listeners receive booleans.
        const bad: number = value;
        void bad;
    });

    ws.on("message", value => {
        value.toUpperCase();

        // @ts-expect-error String packets do not receive numbers.
        value.toFixed();
    });

    ws.on("movement.move", packet => {
        packet.dx.toFixed();
        packet.dy.toFixed();
        packet.dz.toFixed();

        // @ts-expect-error Unknown schema fields should not exist.
        packet.pitch;
    });

    ws.on("snapshot", rows => {
        rows[0].id.toFixed();
        rows[0].x.toFixed();

        // @ts-expect-error Repeated schema rows still reject unknown fields.
        rows[0].missing;
    });

    ws.on("none", value => {
        const empty: undefined = value;
        void empty;
    });

    // @ts-expect-error Unknown client packet tags should not autocomplete or compile.
    ws.on("missing", () => {});

    ws.send("points", 1, 2, 3);
    ws.send("entity.remove", { id: 7 });

    // @ts-expect-error Server packet payload should follow the schema object.
    ws.send("entity.remove", 7);

    // @ts-expect-error Unknown server packet tags should not autocomplete or compile.
    ws.send("missing", 1);
});

server.broadcast("points", 1);
server.broadcast("entity.remove", { id: 9 });

// @ts-expect-error Broadcast send payloads are typed from serverPackets.
server.broadcast("entity.remove", 9);

// @ts-expect-error Unknown broadcast tags should not compile.
server.broadcast("missing", 1);

type BrowserTypes = {
    client: {
        "movement.move": {
            sendArgs: [{ dx: number; dy: number; dz: number }];
            listenerArgs: [{ dx: number; dy: number; dz: number }];
            receive: { dx: number; dy: number; dz: number };
        };
    };
    server: {
        "entity.remove": {
            sendArgs: [{ id: number }];
            listenerArgs: [{ id: number }];
            receive: { id: number };
        };
    };
};

type BrowserTypesSatisfiesProtocol = Assert<BrowserTypes extends SonicProtocolTypes ? true : false>;
declare const browserTypesSatisfiesProtocol: BrowserTypesSatisfiesProtocol;
void browserTypesSatisfiesProtocol;

declare const browserClient: SonicWS<BrowserTypes>;

browserClient.send("movement.move", { dx: 1, dy: 2, dz: 3 });

// @ts-expect-error Client protocol send schema should be enforced.
browserClient.send("movement.move", { dx: 1, dy: 2 });

browserClient.on("entity.remove", packet => {
    packet.id.toFixed();

    // @ts-expect-error Generated client protocol types should reject unknown fields.
    packet.x;
});

// @ts-expect-error Browser client should only accept generated server packet tags in on().
browserClient.on("missing", () => {});
