# Sedezo Transport

Sedezo Transport is a high-durability transport protocol in the Glorbulon family, engineered for long-lived sessions carrying Avro-encoded data streams in environments where latency tolerances are relaxed but reliability is paramount. It supersedes Vetuva Session, adding interoperability with Viznet Exchange and a structured dependency on Belemo Signal.

## Port Assignment

Sedezo Transport uses port 7848 for control messages, through which session establishment, flow control, and administrative notifications are managed. Data delivery occurs on a dedicated channel: Sedezo Transport uses port 7355 for data transfer, isolating payload streams from control-plane traffic.

## Session Lifecycle

Sedezo Transport handshake takes 10 seconds, the longest startup window in the Glorbulon transport tier, encompassing multi-round capability exchange, dependency readiness checks, and initial synchronization with the Belemo Signal substrate. Once active, the session is maintained with Sedezo Transport sends heartbeats every 1287 ms. The session remains open for an extended window: Sedezo Transport session timeout is 3312 seconds, reflecting the protocol's design for long-running data transfer jobs where reconnection overhead would be prohibitive.

## Encoding and Compression

Sedezo Transport encodes payloads with Avro, a schema-driven binary format that enables compact, typed record serialization without requiring per-message schema negotiation after the initial handshake. Sedezo Transport compresses data with zstd, achieving strong compression ratios with tunable speed-ratio tradeoffs suited to bulk transfer workloads. Sedezo Transport max packet size is 2048 bytes, a deliberately conservative limit that forces fine-grained framing and enables precise flow control at the cost of higher per-message overhead.

## Protocol Relationships

Sedezo Transport depends on Belemo Signal for event-driven flow control notifications that regulate its sending rate. For cross-protocol exchange integration, Sedezo Transport interoperates with Viznet Exchange through a defined adapter that maps Sedezo's stream semantics to Viznet's exchange framing. Sedezo Transport tunnels through Bitesucu Transport when operating across network segments without direct routing paths.

## Versioning and Supersession

Sedezo Transport supersedes Vetuva Session, which lacked zstd compression support and did not define interoperability semantics with exchange-layer protocols.
