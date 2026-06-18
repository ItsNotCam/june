# Cihipu Framework

Cihipu Framework is a coordination and orchestration framework in the Glorbulon protocol family, designed to serve as an integration point for heterogeneous service meshes. It extends an established framework base and absorbs responsibilities from a deprecated predecessor protocol, offering improved session durability and more expressive payload semantics.

## Port Assignments

Cihipu Framework uses port 7996 for control messages, over which session negotiation, policy enforcement directives, and heartbeat acknowledgments are exchanged. Cihipu Framework uses port 7473 for data transfer, providing a dedicated channel for framework-level payload delivery separate from control signaling.

## Session Lifecycle

Cihipu Framework handshake takes 6 seconds, reflecting a thorough mutual authentication process and a multi-round capability negotiation that establishes shared encoding, compression, and routing parameters. After the handshake, Cihipu Framework sends heartbeats every 3942 ms to sustain session liveness across potentially unreliable inter-cluster links. Cihipu Framework session timeout is 422 seconds, a relatively short window that encourages active session management and quick reconnection after failures rather than holding stale sessions open indefinitely.

## Encoding and Transport

Cihipu Framework encodes payloads with CBOR, benefiting from its compact binary encoding, native typed-value support, and absence of a required compiled schema — making it flexible for framework-level messages whose structure evolves across versions. To reduce wire volume, Cihipu Framework compresses data with brotli, achieving high compression ratios suitable for the structured, repetitive payloads common in framework coordination traffic. Cihipu Framework max packet size is 39936 bytes, sized to accommodate typical framework state synchronization messages without segmentation.

## Protocol Relationships

Authentication before framework session establishment is handled by a trusted external component: Cihipu Framework authenticates via Borghyl Control, which validates credentials and issues session tokens. Cihipu Framework extends Fivibetu Framework, inheriting its session multiplexing, priority scheduling, and connection management primitives as a foundation. Cihipu Framework supersedes Gimefu Protocol, taking over its inter-service coordination role with stronger delivery guarantees and richer session semantics. For traversal of non-addressable network segments, Cihipu Framework tunnels through Havusase Signal, which provides the relay fabric without requiring direct connectivity between framework peers.

## Operational Notes

The 422-second session timeout is intentionally short for a framework-level protocol. Implementors should build session resumption into their clients, using the session token material provided by Borghyl Control to re-authenticate quickly after a timeout without repeating the full 6-second handshake sequence.
