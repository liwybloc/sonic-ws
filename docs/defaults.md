# Production defaults

| Limit or behavior | Default | Runtime |
|---|---:|---|
| Incoming WebSocket message | 8 MiB | Node server and Python server |
| Rust raw-DEFLATE expansion | 16 MiB global ceiling, tighter schema-derived bounds | All codec paths |
| Client schema-handshake timeout | 10 seconds | Node, browser, Python |
| Required application-handshake timeout | 10 seconds | Node and Python servers |
| Ping/pong timeout | Node: 30-second ping / 10-second pong; Python websockets: 20/20 | Servers |
| Global packet rate | 500 messages/second/direction/connection | Servers |
| Packet rate | Unlimited unless configured | Individual packet |
| Default batch maximum | 10 items | Received client batches |
| Replay retention | 1,000 frames for 120 seconds | Server sessions |
| Volatile drop threshold | 1 MiB queued outbound | Every connection |
| Forced backpressure close | 16 MiB queued outbound | Every connection |
| Listener execution | Serialized by default | Every connection |
| Reconnect | Disabled until requested | Clients |
| Reconnect delay | 500 ms exponential to 10 seconds, 25% jitter | Clients |
| Invalid frame behavior | Close before application callback | Servers |

These limits are library defaults, not capacity recommendations. Public deployments should also configure HTTP/WebSocket connection limits, authentication, proxy limits, idle ping/pong policy, process memory limits, and observable close/error logging.

Use `sendVolatile` for replaceable simulation updates. It returns `false` without encoding when the transport is above the volatile threshold. `sendReliable` is an explicit alias of `send`; reliable sends still close at the hard outbound-buffer limit rather than growing memory indefinitely.
