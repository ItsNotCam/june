# Querban Layer

Querban Layer is a session-management and routing layer that provides structured message delivery over heterogeneous transport substrates. It is positioned between application-level protocols and lower-level transport carriers, offering a unified addressing scheme and deterministic session semantics.

## Port Assignments

Querban Layer uses port 7256 for control messages, managing session tokens, routing table updates, and teardown coordination. Payload delivery operates on a dedicated channel: Querban Layer uses port 7087 for data transfer.

## Encoding and Compression

Querban Layer encodes payloads with Avro, benefiting from its schema-evolution support to allow protocol upgrades without disrupting established sessions. Querban Layer compresses data with deflate, a widely supported algorithm that balances compression efficiency with implementation availability across target runtimes.

## Session Lifecycle

Querban Layer sessions are established through a negotiated handshake. Querban Layer handshake takes 7 seconds, during which routing parameters and schema identifiers are exchanged. Active sessions are sustained by a periodic liveness signal: Querban Layer sends heartbeats every 2781 ms. Sessions that miss the liveness window are reaped: Querban Layer session timeout is 166 seconds, making it one of the shorter-lived sessions in the protocol family — suited to transient routing paths that should not persist after peer departure.

## Packet Constraints

Querban Layer max packet size is 37888 bytes. Payloads that exceed this boundary must be segmented by the sender; Querban Layer's sequence-numbering scheme handles reassembly at the destination.

## Relationships and Lineage

Querban Layer supersedes Wefexa Framework, replacing its static routing tables with a dynamic discovery model. For transit across wide-area segments, Querban Layer tunnels through Faliwu Transport. Querban Layer depends on Sewuzeru Framework for its schema registry and version negotiation services. For cross-domain compatibility, Querban Layer interoperates with Jokavigi Exchange through a published bridge specification.
