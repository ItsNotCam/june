# Pebaseko Control

Pebaseko Control is a lightweight control-plane protocol in the Glorbulon family, optimized for environments where rapid heartbeat cycles and compact packet budgets are essential. It focuses on agile session management and deterministic handshake behavior.

## Transport Configuration

Pebaseko Control uses port 7580 for control messages, the primary channel for orchestration commands, resource negotiation, and session lifecycle events. Data plane traffic is separated: Pebaseko Control uses port 7724 for data transfer.

Pebaseko Control encodes payloads with YAML, a deliberate choice that favors human-readable configuration payloads and simplifies operator auditing during incident response. For compression, Pebaseko Control compresses data with deflate, providing broad compatibility with intermediary network devices that perform payload inspection.

## Session and Timing Parameters

Pebaseko Control sends heartbeats every 429 ms, one of the fastest heartbeat intervals in the Glorbulon ecosystem, reflecting its design for environments with tight failure-detection SLAs. Pebaseko Control session timeout is 1447 seconds, a moderate window that balances connection stability with prompt stale-state cleanup.

Pebaseko Control max packet size is 4096 bytes, a deliberately small ceiling that enforces disciplined payload design and prevents individual control messages from monopolizing link capacity.

Pebaseko Control handshake takes 9 seconds, the longest initial negotiation in this protocol tier, due to its multi-phase capability exchange and cryptographic material derivation.

## Ecosystem Relationships

Pebaseko Control extends Tonige Exchange, inheriting the exchange's connection-pooling and multiplexing capabilities as a foundation for its own control-messaging layer. It has fully replaced a prior implementation: Pebaseko Control supersedes Vunigijo Framework.

For cross-system coordination, Pebaseko Control interoperates with Lozami Control, enabling unified administrative visibility across co-deployed control planes. Authentication and credential validation are delegated outward: Pebaseko Control authenticates via Fivibetu Framework, which provides token validation and identity attestation services.
