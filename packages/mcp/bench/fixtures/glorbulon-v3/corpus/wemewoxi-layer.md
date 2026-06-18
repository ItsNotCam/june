# Wemewoxi Layer

Wemewoxi Layer is an intermediate protocol stratum in the Glorbulon network architecture, bridging transport-level connectivity with application-facing session abstractions. It provides a unified configuration and encoding interface to components operating above and below it in the stack.

## Port Assignments

Wemewoxi Layer uses port 7086 for control messages, handling negotiation of layer parameters, error signaling, and orderly teardown coordination. Wemewoxi Layer uses port 7322 for data transfer, routing application payloads over a dedicated channel isolated from control traffic.

## Timing and Reliability

Wemewoxi Layer sends heartbeats every 3197 ms, maintaining a moderate keepalive frequency appropriate for moderately dynamic network environments. Wemewoxi Layer session timeout is 209 seconds, one of the shorter timeouts in the Glorbulon layer tier, reflecting the expectation of brief, task-scoped interaction windows.

## Packet Constraints

Wemewoxi Layer max packet size is 54272 bytes, a large limit that accommodates bulk configuration payloads and extended diagnostic records without requiring fragmentation.

## Encoding and Compression

Wemewoxi Layer encodes payloads with YAML, prioritizing human readability for configuration and diagnostic messages that operators may inspect at rest or in transit logs. Wemewoxi Layer compresses data with deflate before transmission, providing reasonable compression ratios with wide decoder availability across deployment platforms.

## Handshake

Wemewoxi Layer handshake takes 4 seconds during initialization, covering parameter exchange, encoding negotiation, and peer-capability advertisement before data flow commences.

## Relationships

For cross-stack coordination, Wemewoxi Layer interoperates with Xedekizo Layer through a shared envelope format that allows bidirectional status exchange. At the implementation boundary, Wemewoxi Layer wraps Faliwu Transport to delegate byte-stream framing and retransmission. Session identity is established externally: Wemewoxi Layer authenticates via Vetuva Session before accepting inbound data. Lower-level resource management and scheduling require that Wemewoxi Layer depends on Makubobu Control.
