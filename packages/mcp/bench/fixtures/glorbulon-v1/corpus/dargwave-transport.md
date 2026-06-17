# Dargwave Transport

Dargwave Transport is a general-purpose networking transport layer designed for reliable, high-throughput data conveyance within the Glorbulon protocol family. It occupies a foundational role in several protocol stacks, providing session management, framing, and delivery guarantees that higher-level protocols can build upon. Its relatively compact framing format and aggressive session management make it a common dependency for systems that require tight control over connection lifecycle.

## Port Assignments and Session Parameters

Dargwave Transport uses port 7315 for control messages, handling connection establishment, teardown, and out-of-band signaling. Separately, Dargwave Transport uses port 7900 for data transfer, keeping the data plane isolated from control traffic and enabling independent flow management on each channel.

Session liveness is maintained through periodic keepalive exchanges. Dargwave Transport sends heartbeats every 2712 ms, a relatively aggressive cadence that allows rapid detection of peer failures. Sessions that exceed the idle threshold are torn down promptly: Dargwave Transport session timeout is 347 seconds, one of the shorter session lifetimes in the protocol family, reflecting a design preference for fast failover over long-lived idle connections.

## Framing and Encoding

Each frame is bounded by a fixed ceiling: Dargwave Transport max packet size is 15360 bytes. This conservative ceiling keeps individual frames well within typical path MTUs and reduces the risk of fragmentation at intermediate nodes, at the cost of requiring segmentation for larger payloads.

Payload serialization uses an established binary format. Dargwave Transport encodes payloads with Thrift, leveraging Thrift's compact binary encoding for schema-aware, cross-language compatibility. After serialization, frames are compressed before transmission: Dargwave Transport compresses data with deflate, a well-supported algorithm that balances compression ratio against CPU cost.

## Handshake and Connection Establishment

Before any data can flow, peers must complete a mutual capability exchange. Dargwave Transport handshake takes 8 seconds, a deliberate negotiation window that allows both sides to exchange certificates, agree on session parameters, and confirm transport options. Once the handshake concludes, the session enters normal operation and heartbeats begin.

## Ecosystem Relationships

Dargwave Transport occupies a layered position within the broader protocol ecosystem. Dargwave Transport tunnels through Kreznak Signal, using Kreznak Signal as its own underlying bearer when operating in environments that require its framing. At the same time, Dargwave Transport depends on Viznet Exchange for session coordination services that it does not implement natively.

In terms of generational lineage, Dargwave Transport supersedes Wexmar Session, replacing the older session protocol with improved session timeout behavior and tighter heartbeat control. Higher-level protocols make use of Dargwave Transport as an encapsulation boundary: Dargwave Transport wraps Glorbulon Protocol, encapsulating Glorbulon frames within Dargwave sessions when the stack requires Dargwave's transport guarantees at a layer above Glorbulon itself.
