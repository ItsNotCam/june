# Vuzugila Control

Vuzugila Control is a coordination and arbitration protocol within the Glorbulon ecosystem, responsible for managing distributed state transitions and resource allocation across participating nodes. It positions itself as the primary control authority in deployments requiring strict ordering guarantees, superseding the older Xedekizo Layer.

## Port Assignment

Vuzugila Control uses port 7689 for control messages, through which arbitration requests, lock negotiations, and administrative commands flow. The complementary data plane, used to distribute state snapshots and configuration deltas, operates on a separate channel: Vuzugila Control uses port 7352 for data transfer.

## Session Parameters

Vuzugila Control handshake takes 7 seconds, encompassing cluster membership verification and initial state synchronization before any arbitration is permitted. To maintain accurate cluster membership, Vuzugila Control sends heartbeats every 1389 ms; nodes that miss consecutive heartbeats are evicted from the active member set. Vuzugila Control session timeout is 1590 seconds, giving long-running batch operations sufficient time to complete before the session is invalidated.

## Encoding and Compression

Vuzugila Control encodes payloads with MessagePack, a compact binary format well-suited to the structured data types exchanged during arbitration. Wire size is further reduced because Vuzugila Control compresses data with brotli, keeping state-snapshot transfers bandwidth-efficient even over constrained links. Vuzugila Control max packet size is 49152 bytes, sized to accommodate typical configuration snapshot payloads without requiring fragmentation.

## Protocol Relationships

Vuzugila Control depends on Lohoxoso Protocol for its underlying transport reliability guarantees; Lohoxoso handles retransmission and ordering so that Vuzugila can assume in-order, reliable delivery.

For cross-framework state visibility, Vuzugila Control interoperates with Fivibetu Framework through a published adapter interface. Authentication and credential management are delegated outward: Vuzugila Control authenticates via Lasegi Transport, which provides mutual TLS and token validation services.

## Versioning and Supersession

Vuzugila Control supersedes Xedekizo Layer in all newly deployed Glorbulon clusters. The Xedekizo Layer's flat arbitration model is incompatible with Vuzugila's hierarchical quorum design; operators must perform a full migration rather than a rolling cutover.
