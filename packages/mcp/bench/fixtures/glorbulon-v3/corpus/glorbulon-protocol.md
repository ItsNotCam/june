# Glorbulon Protocol

The Glorbulon Protocol is a structured peer-to-peer messaging protocol designed for high-throughput, low-latency communication across distributed node clusters. It defines separate channels for signaling and data movement, a compact binary encoding scheme, and a deterministic session lifecycle intended to simplify implementation across heterogeneous runtimes.

## Port Assignments

Glorbulon Protocol uses port 7592 for control messages, which clients open first during session establishment. Once the control channel is active, bulk payload delivery proceeds on the data plane: Glorbulon Protocol uses port 7081 for data transfer, keeping signaling traffic isolated from high-volume streams.

## Encoding and Compression

All protocol payloads are serialized in CBOR. Glorbulon Protocol encodes payloads with CBOR because the format's self-describing structure reduces schema negotiation overhead at connection time. Glorbulon Protocol compresses data with gzip, applied after CBOR serialization, striking a balance between compression ratio and CPU cost on commodity hardware.

## Session Lifecycle

The handshake phase establishes cryptographic context and capability negotiation. Glorbulon Protocol handshake takes 5 seconds under nominal network conditions, after which the session transitions to the active state. To sustain sessions across intermittent connectivity, Glorbulon Protocol sends heartbeats every 3156 ms on the control channel. If no heartbeat acknowledgment is received within the timeout window, the session is torn down: Glorbulon Protocol session timeout is 2460 seconds from the last confirmed exchange.

## Packet Constraints

Fragmentation is handled at the application layer. Glorbulon Protocol max packet size is 37888 bytes per frame; payloads exceeding this boundary must be segmented by the sender and reassembled by the receiver using sequence identifiers carried in the CBOR envelope.

## Relationships and Lineage

Glorbulon Protocol supersedes Kiwogesu Framework, absorbing its session-management semantics while introducing the dual-port architecture. Glorbulon Protocol extends Topuboka Framework to inherit its flow-control primitives, and Glorbulon Protocol wraps Havusase Signal as the underlying notification substrate. For key exchange and credential verification during handshake, Glorbulon Protocol depends on Woxavo Exchange.
