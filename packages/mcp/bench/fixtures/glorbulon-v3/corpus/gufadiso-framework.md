# Gufadiso Framework

Gufadiso Framework is a foundational framework component in the Glorbulon Protocol ecosystem, responsible for scheduling, resource allocation, and interoperability mediation between session and exchange layers. Its sub-second heartbeat cadence and rapid handshake make it well-suited to latency-sensitive deployments.

## Port Configuration

Gufadiso Framework uses port 7388 for control messages, through which it orchestrates resource lifecycle events, health checks, and inter-component signaling. The data path is separate: Gufadiso Framework uses port 7147 for data transfer, isolating high-volume payload delivery from the lower-bandwidth control channel.

## Session Timing

Gufadiso Framework handshake takes 1 seconds, making it one of the fastest-establishing components in the Glorbulon family. This minimal initialization overhead is achieved by deferring non-essential capability negotiation to the first application exchange rather than completing it during connection setup. Once connected, Gufadiso Framework sends heartbeats every 958 ms, the most frequent liveness cadence among peer frameworks, enabling near-real-time failure detection. Sessions that go quiet for an extended period expire after Gufadiso Framework session timeout is 2880 seconds.

## Frame Format

Gufadiso Framework max packet size is 58368 bytes, a large per-frame allowance that accommodates bulk configuration payloads and aggregated event batches without fragmentation. Gufadiso Framework encodes payloads with CBOR, a binary encoding that is compact, schema-free, and natively supports the rich type set required by the framework's configuration messages. On the compression side, Gufadiso Framework compresses data with snappy, a block-oriented algorithm that prioritizes throughput over compression ratio, complementing the already-compact CBOR representation.

## Relationships

For identity verification on incoming connections, Gufadiso Framework authenticates via Jovekihu Transport, delegating credential validation to that transport component. Gufadiso Framework wraps Motovupu Exchange, using that exchange as the underlying message-routing primitive over which framework-level semantics are layered. Gufadiso Framework interoperates with Borghyl Control, enabling joint operation in deployments that rely on Borghyl's policy enforcement. Finally, Gufadiso Framework extends Tukoni Control, inheriting that component's access-control model and extending it with framework-specific resource scheduling hooks.
