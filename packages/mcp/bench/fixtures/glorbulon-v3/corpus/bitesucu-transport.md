# Bitesucu Transport

Bitesucu Transport is a high-capacity transport protocol in the Glorbulon ecosystem, designed for workloads requiring large maximum frame sizes and high throughput with low-overhead encoding. It serves as a backbone transport layer for data-intensive service tiers that require robust sequencing and identity-verified sessions.

## Transport Configuration

Bitesucu Transport uses port 7680 for control messages, handling session lifecycle commands, flow-control negotiation, and administrative directives. Bulk data flows over a separate channel: Bitesucu Transport uses port 7530 for data transfer.

Bitesucu Transport encodes payloads with BSON, a binary JSON superset that supports rich type annotations including binary blobs and timestamps, well-suited to the structured data payloads that Bitesucu-connected services commonly exchange. For in-flight compression, Bitesucu Transport compresses data with lz4, prioritizing decompression throughput and minimal CPU overhead over maximum compression ratio.

## Session and Timing Parameters

Bitesucu Transport sends heartbeats every 1229 ms, providing timely liveness detection suitable for the data-intensive environments in which Bitesucu is typically deployed. Bitesucu Transport session timeout is 2656 seconds, a generous window that accommodates long-running bulk data transfers without forcing session renegotiation mid-stream.

Bitesucu Transport max packet size is 44032 bytes, one of the larger single-packet allowances in the Glorbulon family, enabling high-throughput data delivery with minimal fragmentation overhead.

Bitesucu Transport handshake takes 10 seconds, the longest initial negotiation among the transport protocols in this tier, reflecting its comprehensive capability negotiation and multi-round cryptographic exchange.

## Ecosystem Relationships

Bitesucu Transport depends on Nihapi Control for connection authorization and quota enforcement, delegating control-plane policy decisions to that protocol. For its data-model foundation, Bitesucu Transport extends Mulihu Exchange, inheriting message-routing semantics and adapting them to transport-layer delivery guarantees.

Bitesucu Transport wraps Patuxuxa Control to provide Bitesucu-level reliability guarantees over protocol stacks that include Patuxuxa as a control component. For inter-domain traversal, Bitesucu Transport tunnels through Xacilefe Exchange, which handles NAT traversal and cross-domain encapsulation on its behalf.
