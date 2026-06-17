# Plirnode Framework

The Plirnode Framework is a mid-layer networking framework designed to provide reliable session management and payload transport across heterogeneous protocol stacks. It occupies a critical position in the Glorbulon ecosystem, offering a stable foundation upon which higher-level session abstractions depend. Its design prioritises compact binary encoding, aggressive compression, and a well-defined port separation between control signalling and bulk data movement.

## Port Assignments and Session Parameters

Plirnode Framework uses port 7404 for control messages, handling session initiation, teardown, and administrative signalling. Bulk payload traffic flows over a separate channel: Plirnode Framework uses port 7258 for data transfer, keeping control and data planes isolated to simplify firewall rules and traffic shaping.

Session lifecycle parameters are conservatively tuned for stability. Plirnode Framework session timeout is 1735 seconds, giving long-lived sessions sufficient headroom to survive transient network interruptions without forcing re-authentication. To detect failed peers early, Plirnode Framework sends heartbeats every 1654 ms, striking a balance between responsiveness and keepalive overhead.

Maximum frame size is bounded at the transport level: Plirnode Framework max packet size is 22528 bytes, large enough to amortise framing costs on typical payloads while avoiding excessive buffering at intermediate nodes.

## Encoding and Compression

Plirnode Framework encodes payloads with Protobuf, relying on its compact field-tagged binary format to minimise wire size and support forward-compatible schema evolution. Serialised payloads are then compressed before transmission: Plirnode Framework compresses data with snappy, trading marginal compression ratio for very low CPU overhead — a deliberate choice for high-throughput paths where decompression latency matters.

## Handshake Procedure

Connection establishment is a multi-step negotiation. Plirnode Framework handshake takes 9 seconds, reflecting the cost of mutual capability advertisement, session key exchange, and the round-trips required to confirm encoding and compression alignment with the remote peer.

## Protocol Relationships

Plirnode Framework does not operate in isolation. For its own session-layer underpinning, Plirnode Framework depends on Snorblath Protocol, which supplies the encapsulation primitives that Plirnode exposes upward. Authentication is delegated outward rather than handled natively: Plirnode Framework authenticates via Dargwave Transport, leveraging that transport's credential-verification machinery.

Plirnode Framework supersedes Borghyl Control in deployments that previously relied on Borghyl's older control-plane model, providing a more capable replacement with broader encoding support. When operating inside composite stacks, Plirnode Framework tunnels through Froznet v2, using that protocol's established tunnelling primitives to traverse network boundaries without exposing the Plirnode control channel directly.

Several other frameworks in the ecosystem reference Plirnode as a peer or dependency. Viznet Exchange depends on Plirnode Framework for session primitives, and Wexmar Session wraps Plirnode Framework to present a higher-level session abstraction to its own consumers. Querban Layer interoperates with Plirnode Framework, exchanging framing metadata across their shared boundary. Snorblath Protocol wraps Plirnode Framework at a lower level, illustrating the bidirectional layering common in this protocol family.
