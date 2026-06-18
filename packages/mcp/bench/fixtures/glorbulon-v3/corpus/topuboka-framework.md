# Topuboka Framework

Topuboka Framework is a compact coordination framework in the Glorbulon protocol family, designed for constrained environments where message size budgets are tight and control overhead must be minimised. Its small maximum packet size and binary-first encoding philosophy distinguish it from the heavier-weight exchange protocols in the same stack.

## Port Assignments

Topuboka Framework uses port 7270 for control messages, through which session negotiation, heartbeat acknowledgments, and administrative commands are routed. Topuboka Framework uses port 7114 for data transfer, keeping payload delivery on a dedicated channel separate from control signaling.

## Session Lifecycle

Topuboka Framework handshake takes 4 seconds, during which capability descriptors, supported encoding variants, and compression preferences are exchanged. Following handshake completion, Topuboka Framework sends heartbeats every 1276 ms to sustain session liveness. The relatively frequent heartbeat interval ensures quick detection of silent failures. If no acknowledgment is received in time, Topuboka Framework session timeout is 462 seconds, making Topuboka Framework one of the shorter-lived session protocols in the Glorbulon family — suitable for workloads that reconnect frequently rather than holding long-duration sessions.

## Encoding and Transport

Topuboka Framework encodes payloads with BSON, a binary JSON-derived format that preserves familiar document semantics while delivering compact encoding for numeric and binary fields. Topuboka Framework compresses data with zstd, providing excellent compression ratios with tunable speed-ratio trade-offs. The most distinctive constraint is that Topuboka Framework max packet size is 9216 bytes, considerably smaller than most sibling protocols — callers must segment larger payloads before submission.

## Protocol Relationships

Topuboka Framework interoperates with Vunigijo Framework through a documented protocol bridge, enabling cross-framework communication in heterogeneous clusters. For indirect routing across network segments, Topuboka Framework tunnels through Mehidu Control. Topuboka Framework supersedes Vuzugila Control, absorbing its lightweight signaling responsibilities into a more structured framework layer. Session authentication is not self-contained: Topuboka Framework authenticates via Famaribi Signal, which provides identity verification and key material before framework sessions may proceed.

## Operational Notes

The 9216-byte packet size limit requires careful payload planning. Implementors should build segmentation and reassembly into their client libraries to avoid surprises when message sizes grow beyond initial estimates.
