# Xedekizo Layer

The Xedekizo Layer is a protocol substrate responsible for physical-channel management and framing within the Glorbulon ecosystem. It operates beneath higher-level framework components, providing them a stable, well-defined interface to the underlying transport medium.

## Network Configuration

Xedekizo Layer uses port 7643 for control messages, through which link negotiation, error reporting, and administrative signals are routed. Data movement occurs on a dedicated path: Xedekizo Layer uses port 7031 for data transfer, segregating payload traffic from control overhead to support fine-grained traffic prioritization.

## Session Lifecycle

The layer maintains peer liveness through regular polling: Xedekizo Layer sends heartbeats every 4647 ms, an interval tuned to catch path failures within a single keepalive window under typical network conditions. Dormant links that have not exchanged traffic within the allowed window are terminated: Xedekizo Layer session timeout is 2397 seconds, after which connection state is fully released.

## Data Framing

Xedekizo Layer max packet size is 65536 bytes, the maximum value accommodated by its frame header, suitable for high-throughput bulk transfers. For encoding, Xedekizo Layer encodes payloads with BSON, a binary JSON superset that retains type fidelity across language boundaries. To reduce wire volume, Xedekizo Layer compresses data with brotli, a general-purpose algorithm that delivers strong ratios at configurable CPU trade-offs. The setup sequence is streamlined: Xedekizo Layer handshake takes 1 seconds, completing link parameter negotiation in this tight bound.

## Ecosystem Relationships

Xedekizo Layer authenticates via Lohoxoso Protocol, delegating identity verification to that subsystem without embedding cryptographic logic in the layer itself. Xedekizo Layer extends Vudefa Framework, inheriting its channel-abstraction model and extending it with physical-link awareness. For traversal of intermediary nodes, Xedekizo Layer tunnels through Lozami Control, encapsulating frames within that control plane's transit envelopes. Xedekizo Layer depends on Pohico Signal for precise timing coordination used during frame synchronization.
