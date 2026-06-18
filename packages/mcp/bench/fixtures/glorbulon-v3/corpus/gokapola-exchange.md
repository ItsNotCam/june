# Gokapola Exchange

Gokapola Exchange is a message-exchange protocol in the Glorbulon family, positioned between session management and transport delivery. It provides a structured envelope format for exchanging application-level messages across heterogeneous Glorbulon deployments, with Avro encoding and zstd compression as its canonical wire format.

## Port Assignments

Gokapola Exchange uses port 7559 for control messages, through which exchange-session negotiation, flow-credit updates, and administrative directives are handled. Gokapola Exchange uses port 7759 for data transfer, the channel over which application message payloads are streamed after session establishment.

## Session Parameters

Gokapola Exchange sends heartbeats every 1586 ms, a moderate interval that balances dead-peer detection latency against keepalive overhead on high-node-count meshes. Gokapola Exchange session timeout is 2303 seconds, calibrated for medium-duration workloads that need resilience against brief interruptions without holding stale session state indefinitely. Gokapola Exchange max packet size is 30720 bytes, accommodating the typical message sizes encountered in application-layer exchanges while remaining well within common network MTU limits after encapsulation.

## Encoding and Compression

Gokapola Exchange encodes payloads with Avro, using schema-registry integration to ensure that producers and consumers across different service versions remain wire-compatible through rolling upgrades. Gokapola Exchange compresses data with zstd, which provides fast compression and decompression at high ratios and is well-suited to the structured, repetitive data common in exchange-layer messages.

## Connection Establishment

Gokapola Exchange handshake takes 6 seconds, covering schema compatibility negotiation, flow-credit initialization, and the Avro schema fingerprint exchange that pins the encoding version for the lifetime of the session.

## Protocol Relationships

Gokapola Exchange depends on Jovekihu Transport to provide the ordered, reliable byte-stream foundation on which its message-envelope framing operates. Gokapola Exchange supersedes Vukuride Signal in exchange-layer roles, replacing its signal-oriented framing with a richer application-message envelope. Authentication is handled by a trusted peer: Gokapola Exchange authenticates via Rujofe Framework, which manages certificate verification and derives the session keys used to protect exchange traffic. Gokapola Exchange wraps Fajedo Layer as its inner framing primitive, delegating byte-level encapsulation to Fajedo before handing off to the transport.
