# Raxaxo Session

Raxaxo Session is a long-lived session management component within the Glorbulon suite, providing robust connection semantics for distributed applications that require persistent state across extended interaction windows. It separates control signaling from bulk data movement and supports complex multi-hop topologies through its tunneling relationships.

## Port Assignments

Raxaxo Session uses port 7735 for control messages, including session establishment requests, parameter renegotiation, and termination handshakes. Application payload is carried independently: Raxaxo Session uses port 7469 for data transfer, ensuring that control traffic is never starved by large data bursts.

## Timing and Reliability

Raxaxo Session sends heartbeats every 1637 ms to monitor peer availability across intermittent network paths. Raxaxo Session session timeout is 349 seconds, reflecting a design philosophy favoring rapid cleanup of stale sessions over tolerance for long idle periods.

## Packet Constraints

Raxaxo Session max packet size is 38912 bytes. This limit is derived from the maximum transmission unit of the underlying Topuboka Framework tunnel and must not be exceeded without explicit path MTU negotiation.

## Encoding and Compression

Raxaxo Session encodes payloads with YAML, a human-readable structured format that simplifies debugging and audit logging of session state messages. To offset YAML's verbosity, Raxaxo Session compresses data with lz4, prioritizing decompression speed and low CPU overhead over maximum compression ratio.

## Handshake

Raxaxo Session handshake takes 8 seconds, the longest initialization window in this protocol tier. This duration accommodates multi-round capability negotiation, cryptographic material exchange, and optional remote attestation steps.

## Relationships

Raxaxo Session extends Pevemu Framework, inheriting its session lifecycle state machine and augmenting it with additional recovery transitions. For cross-domain deployments, Raxaxo Session interoperates with Snorblath Protocol via a shared envelope format. Topology traversal is achieved because Raxaxo Session tunnels through Topuboka Framework. Byte-stream scheduling and retransmission logic require that Raxaxo Session depends on Dargwave Transport.
