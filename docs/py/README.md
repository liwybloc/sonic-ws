# SonicWS Python documentation

The Python package is an asyncio client and server compatible with the TypeScript SonicWS protocol. It runs the shared Rust codec as packaged WebAssembly through `wasmtime`; Python owns WebSocket lifecycle, callbacks, middleware, JSON conversion, and Python object conversion.

## Contents

- [Getting started](getting-started.md)
- [Packets, enums, JSON, and codec behavior](packets.md)
- [Client API](client.md)
- [Server and connection API](server.md)
- [Middleware](middleware.md)
- [Native core, packaging, and compatibility](runtime.md)

## Public imports

```py
from sonic_ws import (
    SonicWS, SonicWSServer, SonicWSConnection,
    PacketType, Packet, EnumPackage, Undefined,
    create_packet, create_obj_packet, create_enum_packet,
    CreatePacket, CreateObjPacket, CreateEnumPacket,
    define_enum, wrap_enum, dewrap_enum,
    DefineEnum, WrapEnum, DeWrapEnum,
    flatten_data, unflatten_data, FlattenData, UnFlattenData,
    BasicMiddleware, ConnectionMiddleware, ServerMiddleware, BCInfo,
    CloseCodes, get_closure_cause,
    compress_json, decompress_json,
)
```

Snake_case is idiomatic and complete. Compatibility aliases mirror the established TypeScript names where useful.
