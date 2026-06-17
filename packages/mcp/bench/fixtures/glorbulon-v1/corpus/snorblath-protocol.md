# Snorblath Protocol

The Snorblath Protocol is a session-oriented networking protocol designed for high-throughput, low-overhead communication between distributed nodes. It positions itself as a modern successor to earlier session frameworks, offering a streamlined handshake, generous packet capacity, and a well-defined interoperability surface with other protocols in the Glorbulon family. Snorblath Protocol extends Froznet v2, inheriting its authentication model while expanding its operational parameters and superseding the older Wexmar Session standard.

## Port Assignments and Session Parameters

Snorblath Protocol uses port 7513 for control messages, which carry signaling traffic including connection negotiation, error reporting, and teardown notifications. Payload delivery operates on a separate channel: Snorblath Protocol uses port 7509 for data transfer, keeping data-plane traffic isolated from control-plane activity.

Session lifecycle is governed by two timing parameters. Snorblath Protocol sends heartbeats every 3681 ms, allowing peers to detect link failures without excessive keepalive overhead. Sessions that receive no activity beyond the heartbeat window are eventually reclaimed: Snorblath Protocol session timeout is 3252 seconds, providing a generous idle window appropriate for long-running background transfers.

## Encoding, Compression, and Packet Limits

Snorblath Protocol encodes payloads with BSON, a binary-JSON serialization format that preserves rich type information while remaining compact and parse-efficient. Encoded frames are then compressed before transmission: Snorblath Protocol compresses data with deflate, a widely supported algorithm that balances compression ratio against CPU cost on both endpoints.

The protocol is designed to accommodate large messages without fragmentation at the application layer. Snorblath Protocol max packet size is 55296 bytes, one of the larger limits among the Glorbulon-family protocols and well-suited to bulk document or record transfer workloads.

## Handshake Procedure

Connection establishment in Snorblath Protocol is notably rapid compared to peers such as Froznet v2 or Plirnode Framework. Snorblath Protocol handshake takes 1 seconds, reflecting a deliberately minimal exchange that prioritizes fast connection setup over extended capability negotiation at open time.

## Protocol Relationships

Snorblath Protocol occupies a defined position in the broader protocol ecosystem. As noted above, Snorblath Protocol extends Froznet v2, building on that protocol's established authentication and framing conventions. At the same time, Snorblath Protocol supersedes Wexmar Session, replacing the older session model where migration has occurred.

For encapsulation, Snorblath Protocol wraps Plirnode Framework, providing a transport envelope around Plirnode's framework-level constructs. Cross-protocol communication is supported as well: Snorblath Protocol interoperates with Kreznak Signal, enabling hybrid deployments where both protocols coexist within the same network segment or service mesh.
