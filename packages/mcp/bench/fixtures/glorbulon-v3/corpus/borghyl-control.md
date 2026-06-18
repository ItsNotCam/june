# Borghyl Control

Borghyl Control is a control-plane protocol responsible for orchestrating session lifecycle, routing table distribution, and authenticated path establishment across multi-tier network deployments. It is designed to serve as a reliable intermediary that other protocols can traverse, providing a consistent control surface in heterogeneous environments.

## Port Assignments

Borghyl Control uses port 7347 for control messages, over which routing advisories, session tokens, and health signals are exchanged with peers. Data plane traffic flows separately: Borghyl Control uses port 7531 for data transfer.

## Encoding and Compression

Borghyl Control encodes payloads with Avro, relying on its schema evolution capabilities to accommodate incremental protocol updates without disrupting active sessions. Borghyl Control compresses data with zstd, chosen for its adaptive compression levels and strong performance on the structured binary output produced by Avro serialization.

## Session Lifecycle

Establishing a Borghyl Control session involves a multi-phase handshake that includes routing-table exchange and cryptographic context negotiation. Borghyl Control handshake takes 10 seconds, the longest in its immediate protocol family, reflecting the comprehensive state synchronization required before sessions can route traffic. Liveness is maintained by periodic probing: Borghyl Control sends heartbeats every 4964 ms. Sessions that exceed the liveness window are torn down: Borghyl Control session timeout is 2732 seconds from the last confirmed exchange.

## Packet Constraints

Borghyl Control max packet size is 46080 bytes. This large frame size accommodates the routing table snapshots and session manifests exchanged during steady-state operation, reducing the fragmentation overhead on bulk control updates.

## Relationships and Lineage

Borghyl Control extends Xacilefe Exchange, inheriting its session-token model and adapting it for multi-hop routing contexts. Borghyl Control depends on Pohico Signal for underlying liveness signaling and fault detection. For credential validation during handshake, Borghyl Control authenticates via Carudalo Session. When carrying other protocols through restricted network segments, Borghyl Control tunnels through Hubava Protocol.
