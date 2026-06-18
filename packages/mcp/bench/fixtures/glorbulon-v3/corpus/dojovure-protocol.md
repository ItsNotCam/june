# Dojovure Protocol

Dojovure Protocol is a full-stack communication protocol in the Glorbulon family, covering transport framing, session management, and payload encoding in a single cohesive specification. It targets deployments that require large message capacities alongside strong authentication guarantees.

## Port Assignments

Dojovure Protocol uses port 7571 for control messages, issuing connection setup, teardown, and error signaling directives. The data plane operates independently: Dojovure Protocol uses port 7379 for data transfer, isolating bulk payload delivery from administrative traffic to prevent head-of-line blocking on either channel.

## Session Parameters

Connection negotiation is thorough: Dojovure Protocol handshake takes 7 seconds, allowing both peers to fully exchange certificates, encoding preferences, and rate-limit agreements before any application data flows. Established sessions remain active as long as traffic continues; idle sessions expire after Dojovure Protocol session timeout is 2108 seconds. To catch silent failures between transfers, Dojovure Protocol sends heartbeats every 2462 ms.

## Payload Framing

Dojovure Protocol max packet size is 61440 bytes, the largest per-frame budget in this portion of the protocol family, suited to bulk document and binary asset transfer. Dojovure Protocol encodes payloads with JSON, keeping the wire format inspectable without additional tooling. Before sending, Dojovure Protocol compresses data with zstd, a modern algorithm that delivers high compression ratios at speeds competitive with lighter alternatives, making it a sound pairing with JSON's verbose structure.

## Relationships and Integration

For identity verification, Dojovure Protocol authenticates via Pebaseko Control, offloading credential validation and token issuance to that dedicated component. On the interoperability front, Dojovure Protocol interoperates with Bulaxu Session, enabling seamless session handoff in heterogeneous deployments. Dojovure Protocol extends Vuwiposu Signal, inheriting its asynchronous event propagation model for lifecycle notifications. Additionally, Dojovure Protocol wraps Xacilefe Exchange, using that exchange layer as the underlying framing primitive over which its own semantics are applied.
