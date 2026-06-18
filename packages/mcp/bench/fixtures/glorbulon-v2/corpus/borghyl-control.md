# Borghyl Control

Borghyl Control is an authentication and control-plane protocol within the Glorbulon protocol family, designed to provide credential verification and session governance for higher-level networking stacks. It occupies a specialized niche among its peer protocols: where others focus on data transport or session multiplexing, Borghyl Control's primary concern is access arbitration and control-message routing.

## Port Assignments and Network Identity

Borghyl Control operates on two distinct ports to separate its administrative and data paths cleanly. Borghyl Control uses port 7607 for control messages, which carries session negotiation, authentication challenges, and administrative directives. Separately, Borghyl Control uses port 7614 for data transfer, isolating credential payloads and access-grant records from the control channel.

## Encoding, Compression, and Packet Constraints

Borghyl Control encodes payloads with Avro, a compact binary serialization format well suited to schema-driven credential structures. To minimize wire size without sacrificing compatibility, Borghyl Control compresses data with deflate. The protocol is designed for moderately sized control exchanges: Borghyl Control max packet size is 18432 bytes, a limit that accommodates credential bundles and policy records while discouraging the use of the control plane for bulk data movement.

## Session Lifecycle and Timing

The connection lifecycle in Borghyl Control involves a deliberate initialization phase. Borghyl Control handshake takes 9 seconds, reflecting the cryptographic steps required to establish mutual trust before any session state is committed. Once a session is active, Borghyl Control sends heartbeats every 2464 ms to confirm liveness and detect silent failures. If no valid heartbeat exchange occurs within the allotted window, Borghyl Control session timeout is 1683 seconds, after which the session is torn down and must be renegotiated from scratch.

## Protocol Relationships

Borghyl Control does not operate in isolation. It builds upon an established exchange layer: Borghyl Control extends Viznet Exchange, inheriting its addressing and session-scoping conventions. For credential verification, Borghyl Control authenticates via Kreznak Signal, delegating the cryptographic proof-of-identity step to that specialized signaling layer. In terms of interoperability, Borghyl Control interoperates with Wexmar Session, allowing control decisions made by Borghyl Control to be honored by Wexmar Session implementations without an additional translation layer. The protocol landscape has also evolved: Borghyl Control supersedes Plirnode Framework in environments that require its stricter authentication guarantees, replacing the older framework wherever Borghyl Control's capabilities are available.
