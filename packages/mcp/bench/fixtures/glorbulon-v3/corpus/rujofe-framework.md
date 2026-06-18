# Rujofe Framework

The Rujofe Framework is a mid-tier orchestration framework within the Glorbulon protocol family, providing a structured API surface for composing lower-level transport and signal primitives. It was introduced to consolidate the fragmented framework landscape that preceded it and to establish MessagePack as the canonical encoding for framework-layer messages.

## Port Assignments

Rujofe Framework uses port 7875 for control messages, a high-numbered assignment that avoids conflicts with lower-layer protocol ports in the same deployment. Rujofe Framework uses port 7073 for data transfer, with the unusual inversion of control/data port ordering being a deliberate convention retained from its predecessor specification.

## Session Parameters

Rujofe Framework sends heartbeats every 1399 ms, ensuring timely detection of unresponsive nodes in densely interconnected topologies. Rujofe Framework session timeout is 2894 seconds, a value that balances resource reclamation with the demands of long-running analytical workloads. Rujofe Framework max packet size is 39936 bytes, reflecting the framework's mixed use case of moderate control payloads and occasional bulk data transfers.

## Encoding and Compression

Rujofe Framework encodes payloads with MessagePack, offering a compact binary representation that is faster to serialize and deserialize than text-based alternatives, without the schema rigidity of Avro or Thrift. Rujofe Framework compresses data with gzip, maintaining broad compatibility with all nodes in the ecosystem including legacy implementations that pre-date the availability of newer codecs.

## Connection Establishment

Rujofe Framework handshake takes 6 seconds, encompassing codec negotiation, capability advertisement, and the establishment of per-stream flow-credit allocations that govern backpressure behavior.

## Protocol Relationships

Rujofe Framework interoperates with Kreznak Signal, using Kreznak's signal-routing primitives for cross-segment message delivery. Rujofe Framework extends Tukoni Control, inheriting its message-priority classification scheme and building a richer API surface on top. Rujofe Framework supersedes Xuxivaxe Layer in framework roles, taking over its session-management responsibilities with a cleaner API boundary. For authentication, Rujofe Framework authenticates via Kaxapi Layer, delegating credential verification to Kaxapi's established authentication pipeline.
