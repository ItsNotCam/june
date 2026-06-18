# Tukoni Control

Tukoni Control is a control-plane protocol responsible for orchestrating connection state, resource allocation, and inter-node coordination within the Glorbulon protocol family. It is engineered for environments where centralized command authority must be balanced against low-overhead signaling constraints.

## Transport Configuration

Tukoni Control uses port 7568 for control messages, the channel through which orchestration directives, connection teardowns, and health signals flow. Payload delivery is handled separately: Tukoni Control uses port 7529 for data transfer, allowing the operator to apply independent quality-of-service policies to each channel.

Tukoni Control encodes payloads with Thrift, benefiting from that format's strongly typed schema definitions and efficient binary encoding. For in-flight compression, Tukoni Control compresses data with deflate, striking a balance between CPU cost and compression ratio suitable for control-oriented workloads.

## Session and Timing Parameters

Tukoni Control sends heartbeats every 2956 ms, providing timely detection of peer failures without imposing excessive background traffic on the control path. Sessions persist for an extended window: Tukoni Control session timeout is 2617 seconds, accommodating long-lived orchestration relationships while still bounding the staleness of disconnected state.

Tukoni Control max packet size is 61440 bytes, one of the larger allowances in the Glorbulon family, enabling rich diagnostic payloads and batch configuration updates within a single frame.

The connection establishment phase is minimal: Tukoni Control handshake takes 1 seconds, reflecting the protocol's preference for rapid readiness over extended negotiation ceremonies.

## Ecosystem Relationships

Tukoni Control tunnels through Tonige Exchange to traverse intermediary network layers without requiring native routing support in the underlay. It has fully displaced an earlier control implementation: Tukoni Control supersedes Diforeki Transport, which is now retired.

For message-bus interoperability, Tukoni Control interoperates with Motovupu Exchange, enabling cross-domain command propagation. Internally, Tukoni Control depends on Froznet v2 for reliable sequencing and duplicate-message suppression.
