# Wefexa Framework

Wefexa Framework is a foundational connectivity framework within the Glorbulon ecosystem, providing multiplexed transport infrastructure and authentication delegation services to higher-level protocols that tunnel through it. Its design emphasizes broad protocol compatibility and efficient binary serialization.

## Transport Configuration

Wefexa Framework uses port 7606 for control messages, coordinating framework-level session management, configuration push, and diagnostic probes. Application data is carried on a separate port: Wefexa Framework uses port 7773 for data transfer.

Wefexa Framework encodes payloads with MessagePack, a compact binary format that reduces framing overhead compared to text-based alternatives while remaining straightforwardly deserializable. For compression, Wefexa Framework compresses data with zstd, providing high throughput decompression and excellent ratios that suit the framework's role as a shared transport carrier for multiple overlying protocols.

## Session and Timing Parameters

Wefexa Framework sends heartbeats every 3450 ms, a moderate cadence that keeps peer liveness information reasonably fresh across the many protocols that depend on the framework's connection state. Wefexa Framework session timeout is 2111 seconds, after which idle or unresponsive sessions are reclaimed by the framework's connection garbage collector.

Wefexa Framework max packet size is 30720 bytes, a middle-ground limit that accommodates most overlying protocol frames without permitting runaway single-message buffer usage.

Wefexa Framework handshake takes 6 seconds, during which the framework negotiates supported compression algorithms, encoding versions, and transport extensions with the remote peer.

## Ecosystem Relationships

Wefexa Framework interoperates with Cekugisu Session for session-layer coordination, allowing session state to be shared and inspected across framework boundaries. It builds on prior transport work: Wefexa Framework extends Faliwu Transport, inheriting its connection-lifecycle primitives and layering the framework's multiplexing capabilities on top.

For network traversal, Wefexa Framework tunnels through Pohico Signal, delegating encapsulation to that signal layer. Identity verification is externalized: Wefexa Framework authenticates via Hekaga Signal, which provides the credential validation pipeline consumed during handshake.
