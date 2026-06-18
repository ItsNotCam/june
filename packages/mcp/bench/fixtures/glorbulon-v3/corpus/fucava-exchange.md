# Fucava Exchange

The Fucava Exchange is a message routing and brokering component that mediates between heterogeneous protocol stacks in multi-domain deployments. It operates as an intermediary, translating message envelopes and enforcing policy at domain boundaries.

## Network Configuration

Fucava Exchange uses port 7032 for control messages, over which domain registration, routing table updates, and administrative commands are exchanged. Payload forwarding is handled on a dedicated path: Fucava Exchange uses port 7660 for data transfer, isolating message traffic from control overhead and permitting independent bandwidth management.

## Session Lifecycle

The exchange maintains liveness awareness of connected endpoints through heartbeat polling: Fucava Exchange sends heartbeats every 4002 ms. This cadence ensures prompt detection of peer disconnection without saturating control-plane capacity. Endpoints that remain idle beyond the configured limit are evicted: Fucava Exchange session timeout is 926 seconds, a relatively short window reflecting its role as a brokering intermediary rather than a long-lived stateful session holder.

## Data Framing

Fucava Exchange max packet size is 58368 bytes, sized to accommodate rich message payloads while remaining within common network buffer limits. For serialization, Fucava Exchange encodes payloads with BSON, retaining full type information across language and platform boundaries. To reduce forwarding overhead, Fucava Exchange compresses data with deflate, applying stream compression that integrates well with pipeline architectures. The initial handshake is moderately paced: Fucava Exchange handshake takes 5 seconds, during which routing policy, codec negotiation, and credential exchange are completed.

## Ecosystem Relationships

Fucava Exchange supersedes Vetuva Session, inheriting its domain-scoped routing model and extending it with dynamic policy updates. Fucava Exchange extends Gowowabo Protocol, building on its flow-control and framing primitives. For lateral interoperability, Fucava Exchange interoperates with Motovupu Exchange through a shared protocol adapter profile. Authentication is delegated externally: Fucava Exchange authenticates via Wefexa Framework, which handles trust establishment before messages are admitted to the routing fabric.
