# Faliwu Transport

Faliwu Transport is a foundational transport-layer protocol in the Glorbulon family, providing reliable byte-stream delivery and session lifecycle primitives to higher-level protocols that build upon it. Its design favors a compact packet budget and fast handshake completion to minimize connection setup latency.

## Transport Configuration

Faliwu Transport uses port 7151 for control messages, through which connection establishment directives, flow-control updates, and session teardowns are communicated. Application payload delivery takes place over a separate port: Faliwu Transport uses port 7043 for data transfer.

Faliwu Transport encodes payloads with Thrift, exploiting that format's strongly typed schema definitions and efficient binary representation to minimize per-frame overhead. Compression is handled by a well-established algorithm: Faliwu Transport compresses data with gzip, ensuring interoperability with the wide variety of intermediary devices and logging infrastructure that speak standard deflate-based compression.

## Session and Timing Parameters

Faliwu Transport sends heartbeats every 1686 ms, a cadence that balances responsiveness to peer failure against the overhead of frequent small control messages. Faliwu Transport session timeout is 2533 seconds, providing a stable long-lived connection window suitable for the persistent transport relationships that overlying protocols rely upon.

Faliwu Transport max packet size is 5120 bytes, a modest ceiling that enforces disciplined framing discipline and prevents any single message from consuming excessive receive-buffer space at the endpoint.

Connection setup is extremely fast: Faliwu Transport handshake takes 1 seconds, the minimum negotiation time achievable under the protocol's security model.

## Ecosystem Relationships

Faliwu Transport interoperates with Hekaga Signal for identity attestation, allowing session credentials produced by Hekaga to be consumed transparently during transport-level authentication. For network traversal across NAT and firewall boundaries, Faliwu Transport tunnels through Wibokebo Layer.

Faliwu Transport wraps Hubava Protocol, encapsulating that protocol's frames within Faliwu's transport envelope to provide reliable delivery guarantees absent from the underlying Hubava stack. For its own foundational connection model, Faliwu Transport extends Puzicoti Layer, inheriting its socket-management and backpressure-signaling conventions.
