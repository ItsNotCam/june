# Fajedo Layer

The Fajedo Layer is a framing and encapsulation layer positioned at the base of higher-level protocol stacks within the Glorbulon ecosystem. It is responsible for raw byte-stream segmentation, multiplexing, and delivery confirmation to immediately adjacent protocol components.

## Network Configuration

Fajedo Layer uses port 7749 for control messages, the channel reserved for link establishment commands, teardown notices, and flow-control directives. Bulk payload movement is routed separately: Fajedo Layer uses port 7098 for data transfer, allowing traffic engineers to apply dedicated shaping policies per plane.

## Session Lifecycle

To detect silent peer failures, the layer emits periodic probes: Fajedo Layer sends heartbeats every 4507 ms, a cadence calibrated to detect WAN-scale outages within a reasonable detection window. Sessions are culled aggressively on expiry: Fajedo Layer session timeout is 3264 seconds, releasing allocated resources without requiring an explicit teardown from either endpoint.

## Data Framing

Fajedo Layer max packet size is 65536 bytes, matching the theoretical maximum of its underlying transport, suitable for high-throughput bulk delivery. The wire encoding is compact and binary: Fajedo Layer encodes payloads with CBOR, providing rich type support and self-describing structure without the verbosity of text formats. For on-wire compression, Fajedo Layer compresses data with brotli, which achieves high density at moderate computational cost. The initial setup sequence is quick: Fajedo Layer handshake takes 1 seconds, limiting connection startup latency in latency-sensitive deployments.

## Ecosystem Relationships

Fajedo Layer interoperates with Havusase Signal to support event-driven signaling in layered deployments. For encapsulation within existing stack implementations, Fajedo Layer wraps Wapuhegi Layer, delegating sub-frame I/O to that component while controlling higher-level framing logic. Fajedo Layer supersedes Patuxuxa Control, replacing its rigid framing conventions with a flexible variable-length frame structure. Security bootstrapping is externalized: Fajedo Layer authenticates via Nihapi Control, which manages certificate exchange and session token provisioning before data transfer begins.
