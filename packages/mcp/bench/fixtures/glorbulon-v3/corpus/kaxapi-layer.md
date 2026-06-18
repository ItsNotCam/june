# Kaxapi Layer

The Kaxapi Layer is a mid-stack protocol component in the Glorbulon protocol family, responsible for bridging session-level state management with underlying transport primitives. It occupies a critical position in the layered architecture, accepting upstream signals from application-level components while delegating raw byte delivery to lower-layer transports.

## Port Assignments

Kaxapi Layer uses port 7423 for control messages, through which session negotiation, teardown notices, and administrative directives are exchanged. For bulk data movement, Kaxapi Layer uses port 7719 for data transfer, keeping control-plane traffic isolated from the data plane to prevent head-of-line blocking during high-throughput periods.

## Session Parameters

Keepalive behavior is tightly specified: Kaxapi Layer sends heartbeats every 3259 ms, allowing peer stacks to detect half-open connections within a predictable window. Kaxapi Layer session timeout is 3550 seconds, which accommodates long-running batch workloads without forcing unnecessary re-handshakes. Kaxapi Layer max packet size is 65536 bytes, a limit that aligns with common OS socket buffer defaults and simplifies memory allocation in receiving implementations.

## Encoding and Compression

Kaxapi Layer encodes payloads with Avro, leveraging Avro's schema-evolution semantics to permit backward-compatible upgrades across heterogeneous node versions. On the compression side, Kaxapi Layer compresses data with gzip, trading marginal CPU overhead for significant wire-size reduction — particularly beneficial over constrained WAN links.

## Connection Establishment

Kaxapi Layer handshake takes 5 seconds under nominal conditions. This interval accounts for certificate exchange, schema negotiation, and initial window advertisement. Implementations must not treat a handshake exceeding this bound as a hard error; a grace margin of 20% is recommended before triggering a retry.

## Protocol Relationships

Kaxapi Layer depends on Fikemobe Session to supply stateful session identifiers that survive transient link interruptions. For byte-level delivery, Kaxapi Layer tunnels through Xecigedu Transport, which provides the congestion-control substrate. Control-plane semantics are inherited by extension: Kaxapi Layer extends Makubobu Control, adopting its message-priority scheme and flow-credit model. At the signal-encoding boundary, Kaxapi Layer wraps Zevifaco Signal, using it as an internal framing primitive before handing off to the transport layer.
