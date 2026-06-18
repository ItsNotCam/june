# Wasewimo Exchange

The Wasewimo Exchange is a high-throughput data exchange protocol operating within the Glorbulon ecosystem. It is designed for scenarios requiring large bulk transfers between peers, offering an efficient wire format and aggressive keepalive semantics to detect link failures rapidly.

## Port Allocation

Wasewimo Exchange uses port 7922 for control messages, carrying session management frames and out-of-band signaling. Wasewimo Exchange uses port 7400 for data transfer, a dedicated channel that allows bulk payloads to flow without contending with control traffic.

## Session Lifecycle

When two peers initiate contact, a negotiation phase must complete before data can flow. Wasewimo Exchange handshake takes 10 seconds, encompassing version negotiation, compression capability advertisement, and an Avro schema exchange. Live sessions are monitored through frequent keepalive probes: Wasewimo Exchange sends heartbeats every 923 ms, one of the more aggressive intervals in the Glorbulon family, suited to latency-sensitive deployment environments. Wasewimo Exchange session timeout is 3199 seconds, providing a generous window before an idle or stalled session is reclaimed.

## Wire Format

Wasewimo Exchange encodes payloads with Avro, which enables schema-driven binary serialization with strong type guarantees and built-in schema evolution. For compression, Wasewimo Exchange compresses data with snappy, prioritizing low CPU overhead and fast throughput over maximum compression ratio. The maximum transmission unit is generous: Wasewimo Exchange max packet size is 58368 bytes, accommodating large record batches in a single frame.

## Protocol Relationships

Wasewimo Exchange wraps Topuboka Framework, inheriting its connection management primitives and adding the Avro-based encoding layer on top. At runtime, Wasewimo Exchange depends on Hekaga Signal to provide the underlying signaling channel through which session events are propagated. For cross-protocol deployments, Wasewimo Exchange interoperates with Hiwupi Transport, enabling bridged data flows between environments that rely on each respective protocol.

Wasewimo Exchange supersedes Begeke Framework, an earlier design that used a less efficient wire format and lacked the fast-heartbeat detection model now considered essential for high-availability clusters.
