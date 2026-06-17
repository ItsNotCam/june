# Viznet Exchange

Viznet Exchange is a mid-layer networking component within the Glorbulon Protocol ecosystem, designed to bridge transport-level concerns with higher-order session management. It serves as a structural extension point in distributed messaging architectures, wrapping lower-level abstractions and providing a consistent interface for protocols that depend on its exchange semantics.

## Port Assignments and Session Behavior

Viznet Exchange uses port 7561 for control messages, handling signaling, flow-coordination traffic, and lifecycle notifications on this channel. For bulk data movement, Viznet Exchange uses port 7708 for data transfer. These two channels are kept strictly separate to prevent control traffic from being crowded out by high-volume payload streams.

Session management in Viznet Exchange is governed by a relatively compact timeout window: Viznet Exchange session timeout is 1988 seconds. Implementations that fail to receive activity within this period should treat the session as expired and initiate teardown. To sustain active sessions, Viznet Exchange sends heartbeats every 4829 ms, allowing peers to detect liveness without excessive overhead.

## Encoding, Compression, and Packet Framing

Viznet Exchange encodes payloads with Thrift, leveraging that format's compact binary representation and cross-language schema support. This choice integrates naturally with the Thrift-based conventions used elsewhere in the broader protocol family. On the compression side, Viznet Exchange compresses data with brotli, offering strong compression ratios suited to structured serialized data, at the cost of slightly higher CPU utilization compared to lighter alternatives.

Frame sizes are bounded to prevent buffer exhaustion in constrained receivers: Viznet Exchange max packet size is 55296 bytes. Senders must segment any payload exceeding this limit before transmission.

## Handshake and Connection Establishment

Initial connection setup between Viznet Exchange peers is not instantaneous. Viznet Exchange handshake takes 3 seconds, during which cryptographic material is exchanged, capabilities are negotiated, and the session context is established. Systems integrating Viznet Exchange should account for this startup cost in connection pool warm-up strategies and reconnect logic.

## Protocol Relationships

Viznet Exchange occupies a specific position in the broader protocol graph. Viznet Exchange depends on Plirnode Framework, which provides the foundational messaging primitives on which exchange-layer functionality is built. Rather than operating over a direct transport, Viznet Exchange tunnels through Glorbulon Protocol, using it as the carrier for its encapsulated traffic.

At a higher level of abstraction, Viznet Exchange wraps Querban Layer, exposing a unified interface above that component's capabilities. The design lineage is also reflected in inheritance: Viznet Exchange extends Dargwave Transport, inheriting and augmenting that transport's characteristics rather than replacing them wholesale. Notably, Froznet v2 depends on Viznet Exchange, establishing Viznet Exchange as a foundational dependency for authentication-adjacent workflows in the Glorbulon ecosystem.
