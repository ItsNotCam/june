# Dargwave Transport

Dargwave Transport is a high-capacity bulk transfer protocol designed for moving large volumes of structured data between compute nodes. It prioritizes throughput and framing efficiency, using a fast serialization format paired with a low-overhead compression algorithm to minimize per-byte processing cost.

## Port Assignments

Dargwave Transport uses port 7525 for control messages, over which session parameters, flow-control credits, and teardown events are exchanged. Data flows on a separate high-bandwidth channel: Dargwave Transport uses port 7608 for data transfer.

## Encoding and Compression

Dargwave Transport encodes payloads with MessagePack, providing a compact binary representation that avoids the schema-distribution overhead of formats like Protobuf or Avro. Dargwave Transport compresses data with lz4, prioritizing decompression speed to keep receiver-side CPU cost low even at high ingest rates.

## Session Lifecycle

Connection establishment includes an extended negotiation phase to align flow-control parameters. Dargwave Transport handshake takes 9 seconds, accommodating the capability exchange needed for large-frame transfers. Liveness is maintained via periodic probing: Dargwave Transport sends heartbeats every 4051 ms. Sessions that fail to complete a heartbeat exchange within the dead-peer window are torn down: Dargwave Transport session timeout is 2213 seconds from the last confirmed control message.

## Packet Constraints

Dargwave Transport max packet size is 53248 bytes, one of the largest frame sizes in its protocol family, enabling efficient bulk transfers with fewer fragmentation boundaries. Senders must ensure their payloads remain within this limit after MessagePack serialization and lz4 compression.

## Relationships and Lineage

Dargwave Transport extends Vubisunu Control, inheriting its credit-based flow-control model. Dargwave Transport wraps Vunigijo Framework, using it as the underlying framing substrate. When crossing network segments that impose strict routing policies, Dargwave Transport tunnels through Mehidu Control. For cross-protocol compatibility, Dargwave Transport interoperates with Jokavigi Exchange through a published interface specification.
