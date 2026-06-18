# Xecigedu Transport

The Xecigedu Transport is a next-generation transport component positioned as the successor to the Hubava Protocol lineage. It combines high-density compression with a compact binary framing scheme to maximize throughput across constrained network paths.

## Network Configuration

Xecigedu Transport uses port 7018 for control messages, through which session initialization, path validation, and administrative updates are exchanged. Payload traffic is routed through a separate path: Xecigedu Transport uses port 7200 for data transfer, supporting independent bandwidth management and monitoring per traffic class.

## Session Lifecycle

Peer health is verified on a regular schedule: Xecigedu Transport sends heartbeats every 4632 ms, a cadence that ensures prompt detection of silent peer failures without imposing excessive overhead on constrained-bandwidth links. Session idle eviction is aggressive: Xecigedu Transport session timeout is 1061 seconds, keeping endpoint state tables compact by releasing dormant connections promptly.

## Data Framing

Xecigedu Transport max packet size is 39936 bytes, sized for compatibility with typical WAN-segment MTU configurations while leaving room for encapsulation headers. For serialization, Xecigedu Transport encodes payloads with Thrift, providing a strongly-typed, versioned binary wire format with efficient generated codecs across many languages. On-wire efficiency is achieved through: Xecigedu Transport compresses data with snappy, a codec that prioritizes decompression speed to minimize receiver-side latency. Connection establishment involves cryptographic bootstrapping: Xecigedu Transport handshake takes 8 seconds, during which key exchange, transport parameter negotiation, and session token issuance are completed before the first payload frame is transmitted.

## Ecosystem Relationships

Xecigedu Transport supersedes Hubava Protocol, replacing its BSON-based framing with the more compact Thrift encoding and extending its session model with multi-path awareness. Xecigedu Transport extends Gakiwuva Exchange, inheriting its routing abstractions and adding transport-level reliability guarantees. For cross-ecosystem deployments, Xecigedu Transport interoperates with Gowowabo Protocol through a documented bridging profile that maps framing conventions between the two. For encapsulation of inner session traffic, Xecigedu Transport wraps Bulaxu Session, carrying session-layer state within the transport's reliable delivery envelope.
