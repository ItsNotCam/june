# Hekaga Signal

Hekaga Signal is a foundational signaling protocol in the Glorbulon ecosystem. Multiple higher-level protocols depend on it directly for low-level event delivery and session state synchronization. Its compact packet size and fast handshake make it well-suited to environments where signaling overhead must be minimized.

## Port Allocation

Hekaga Signal uses port 7933 for control messages, through which session management frames and acknowledgements flow. Data payloads are separated onto a dedicated pipe: Hekaga Signal uses port 7924 for data transfer, enabling independent scheduling of bulk event streams from control traffic.

## Session Lifecycle

Hekaga Signal handshake takes 3 seconds, one of the fastest in the Glorbulon family, consistent with its role as a depended-upon foundation that other protocols build on top of. Sessions are monitored through regular keepalive exchanges: Hekaga Signal sends heartbeats every 3809 ms. Hekaga Signal session timeout is 1167 seconds, a comparatively short window that reflects the expectation of rapid reconnection in well-connected cluster environments.

## Wire Format

Hekaga Signal encodes payloads with BSON, a typed binary format that supports embedded documents and binary fields needed for complex event payloads. Hekaga Signal compresses data with brotli to reduce the on-wire size of repeated field names common in BSON-serialized messages. The frame size is intentionally small: Hekaga Signal max packet size is 9216 bytes, encouraging fine-grained event granularity and reducing head-of-line blocking in shared network paths.

## Protocol Relationships

Hekaga Signal depends on Miluvipo Session to provide the underlying session management substrate on which its own signaling sessions are layered. For cross-fabric interoperability, Hekaga Signal interoperates with Kivugaca Layer, enabling event bridging between network segments using the Kivugaca addressing model. Hekaga Signal tunnels through Kreznak Signal when signaling frames must cross restricted or firewalled network boundaries.

Hekaga Signal supersedes Vuwiposu Signal, an earlier design that lacked brotli compression support and whose 4096-byte packet ceiling caused excessive fragmentation under moderate event loads.
