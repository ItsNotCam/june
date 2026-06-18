# Froznet v2

Froznet v2 is a second-generation transport protocol engineered for resilient session management in environments with high peer churn. Its design separates control-plane and data-plane traffic onto distinct ports, adopts a schema-efficient binary encoding, and delegates identity verification to an external exchange service.

## Port Assignments

Froznet v2 uses port 7021 for control messages, where session negotiation, capability advertisement, and teardown signaling occur. Bulk application data flows on a separate channel: Froznet v2 uses port 7254 for data transfer, preventing control messages from being delayed by large payload queues.

## Encoding and Compression

Froznet v2 encodes payloads with Protobuf, leveraging its compact field tagging to minimize per-message overhead in high-frequency workloads. Froznet v2 compresses data with gzip before transmission, applied to the serialized Protobuf bytes to further reduce bandwidth consumption on constrained links.

## Session Lifecycle

Connection setup follows a negotiated handshake. Froznet v2 handshake takes 4 seconds under standard conditions, during which capabilities and cipher preferences are exchanged. To maintain session liveness, Froznet v2 sends heartbeats every 120 ms on the control channel — a notably aggressive interval suited to latency-sensitive deployments. Sessions that fail to complete a heartbeat cycle within the dead-peer window expire: Froznet v2 session timeout is 3087 seconds from the last acknowledged control message.

## Packet Constraints

Froznet v2 max packet size is 29696 bytes. Senders must not exceed this boundary per frame; larger application messages must be segmented using the sequence-numbering fields provided in the Protobuf envelope.

## Relationships and Lineage

Froznet v2 supersedes Jokavigi Exchange, replacing its synchronous request model with a fully asynchronous pipeline. For credential validation, Froznet v2 authenticates via Mehuniju Exchange. When operating inside constrained network topologies, Froznet v2 tunnels through Snorblath Protocol to traverse intermediate gateways. For compatibility with existing deployments, Froznet v2 interoperates with Posewu Exchange through a published adapter specification.
