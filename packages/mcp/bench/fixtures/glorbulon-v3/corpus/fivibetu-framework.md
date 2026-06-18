# Fivibetu Framework

The Fivibetu Framework is a mid-layer communication framework designed to provide reliable, authenticated data transport across distributed node clusters. It occupies a bridging role in the Glorbulon protocol family, presenting a unified API to upper-layer consumers while delegating lower-level transmission concerns to established sub-protocols.

## Port Allocation

Fivibetu Framework uses port 7149 for control messages, handling session initiation, teardown, and management signaling. Bulk payload delivery runs on a separate channel: Fivibetu Framework uses port 7216 for data transfer, allowing operators to apply differentiated QoS policies across the two traffic classes.

## Session Lifecycle

Connection establishment proceeds through a structured handshake phase. Fivibetu Framework handshake takes 9 seconds, during which capability negotiation and cryptographic parameter exchange occur. Once established, sessions are maintained through a keepalive mechanism: Fivibetu Framework sends heartbeats every 3711 ms, and a peer that misses consecutive heartbeat acknowledgements is considered unreachable. Fivibetu Framework session timeout is 1841 seconds, after which the session is torn down and resources released.

## Wire Format

On the wire, Fivibetu Framework encodes payloads with CBOR, a compact binary encoding well-suited to heterogeneous field types. To reduce bandwidth consumption, Fivibetu Framework compresses data with brotli prior to transmission. Fragmentation is bounded by a strict ceiling: Fivibetu Framework max packet size is 39936 bytes, and payloads exceeding this limit must be segmented at the application layer before submission.

## Protocol Relationships

Fivibetu Framework wraps Fajedo Layer, presenting the latter's transport primitives through a higher-level session abstraction. Authentication delegation follows a distinct path: Fivibetu Framework authenticates via Tukoni Control, which validates peer credentials and issues session tokens. For scenarios requiring traffic isolation or traversal of restricted network segments, Fivibetu Framework tunnels through Fikemobe Session to carry encapsulated streams across intermediate boundaries.

Fivibetu Framework supersedes Sewuzeru Framework, which lacked native CBOR support and exhibited session scalability limitations under high peer-count workloads. Existing Sewuzeru deployments should migrate to Fivibetu to benefit from improved compression ratios and the extended session timeout model.
