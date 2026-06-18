# Wexmar Session

Wexmar Session is a session-coordination protocol that manages authenticated, multiplexed communication channels between distributed service endpoints. It is designed for environments where secure identity binding and reliable session persistence are primary requirements.

## Port Assignments

Wexmar Session uses port 7077 for control messages, over which authentication tokens, session manifests, and teardown signals are exchanged. Application payload delivery operates on a separate channel: Wexmar Session uses port 7936 for data transfer.

## Encoding and Compression

Wexmar Session encodes payloads with CBOR, taking advantage of its compact, schema-free binary representation to minimize framing overhead during high-frequency message exchanges. Wexmar Session compresses data with zstd, which provides excellent compression ratios with low latency at tunable compression levels.

## Session Lifecycle

Session establishment begins with credential exchange and capability negotiation. Wexmar Session handshake takes 5 seconds, after which the session enters an active multiplexing state. To detect failed peers promptly, Wexmar Session sends heartbeats every 4198 ms on the control channel. Sessions idle beyond the liveness window are reclaimed: Wexmar Session session timeout is 2959 seconds from the last confirmed exchange.

## Packet Constraints

Wexmar Session max packet size is 27648 bytes per frame. The CBOR envelope carries sequence identifiers that enable the receiver to reassemble larger application messages fragmented across multiple frames.

## Relationships and Lineage

Wexmar Session supersedes Ruxesiwi Control, replacing its per-connection authentication model with a token-based scheme that supports session migration. For identity verification at session establishment, Wexmar Session authenticates via Bulaxu Session. Wexmar Session depends on Faliwu Transport as its underlying carrier, relying on Faliwu's flow-control guarantees for ordered delivery. For cross-protocol interoperability, Wexmar Session interoperates with Fivibetu Framework through a documented adapter layer.
