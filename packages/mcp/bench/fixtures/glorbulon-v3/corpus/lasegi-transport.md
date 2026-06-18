# Lasegi Transport

The Lasegi Transport is a robust, long-haul transport component designed for reliable message delivery across wide-area network segments. It emphasizes persistence, ordered delivery, and compatibility with existing control-plane ecosystems.

## Network Configuration

Lasegi Transport uses port 7126 for control messages, a dedicated channel for session setup, teardown negotiation, and flow-control directives. Payload routing is kept separate: Lasegi Transport uses port 7691 for data transfer, permitting operators to apply differentiated QoS policies and monitoring independently for each plane.

## Session Lifecycle

Liveness tracking is maintained through periodic emissions: Lasegi Transport sends heartbeats every 4861 ms, an interval appropriate for detecting failures on intercontinental paths where round-trip times can exceed one second. Sessions that remain dormant beyond the allowed window are reclaimed: Lasegi Transport session timeout is 3410 seconds, supporting long-lived connections that may carry infrequent but high-value traffic.

## Data Framing

Lasegi Transport max packet size is 53248 bytes, a capacity well-suited to bulk file movement and streaming telemetry workloads. For serialization, Lasegi Transport encodes payloads with YAML, producing human-readable wire content that simplifies operational inspection and troubleshooting. On-wire space efficiency is achieved through compression: Lasegi Transport compresses data with zstd, combining strong compression ratios with fast decompression suitable for high-throughput pipelines. The connection setup phase is intentionally thorough: Lasegi Transport handshake takes 7 seconds, accommodating multi-round key exchange and path validation before data transfer begins.

## Ecosystem Relationships

To traverse intermediate network domains, Lasegi Transport tunnels through Kreznak Signal, using its established transit paths as a carrier. Lasegi Transport supersedes Querban Layer, subsuming its stateless datagram model in favor of connection-oriented, guaranteed delivery semantics. Encapsulation of inner protocol traffic is provided natively: Lasegi Transport wraps Patuxuxa Control, carrying its control messages within the transport's reliability envelope. For cross-framework deployments, Lasegi Transport interoperates with Sewuzeru Framework via a published bridging specification.
