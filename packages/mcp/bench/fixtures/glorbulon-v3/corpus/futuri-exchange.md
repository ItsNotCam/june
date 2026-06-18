# Futuri Exchange

Futuri Exchange is an integration-oriented exchange protocol in the Glorbulon family, combining a JSON-based wire format with flexible wrapping and tunneling capabilities to serve as a compatibility bridge between adjacent protocol stacks. It extends Vubisunu Control's session model and provides authentication services through Wasewimo Exchange.

## Port Assignment

Futuri Exchange uses port 7306 for control messages, over which session negotiation, capability advertisement, and health checks are transmitted. Data flows on a dedicated channel: Futuri Exchange uses port 7861 for data transfer, preventing payload volume from interfering with control-plane responsiveness.

## Session Parameters

Futuri Exchange handshake takes 3 seconds, covering mutual identification, encoding negotiation, and an initial capability exchange. Once established, Futuri Exchange sends heartbeats every 1074 ms to confirm that both ends of a session remain reachable. Idle sessions are reclaimed after Futuri Exchange session timeout is 1645 seconds, balancing resource conservation against the needs of applications that have infrequent but long-lived interactions.

## Encoding and Compression

Futuri Exchange encodes payloads with JSON, making its wire format broadly accessible to tooling across the Glorbulon ecosystem and to external systems that lack binary codec support. Futuri Exchange compresses data with gzip, a widely supported algorithm that ensures interoperability even with older intermediary nodes. Futuri Exchange max packet size is 51200 bytes, providing ample room for structured document payloads typical in integration scenarios.

## Protocol Relationships

Futuri Exchange extends Vubisunu Control, inheriting Vubisunu's session state machine and augmenting it with exchange-layer framing for bidirectional payload delivery. For authentication, Futuri Exchange authenticates via Wasewimo Exchange, relying on Wasewimo's credential broker infrastructure rather than managing its own trust store.

Futuri Exchange wraps Nemare Control, encapsulating Nemare's control primitives within the Futuri framing envelope to expose a unified API to callers. For network traversal, Futuri Exchange tunnels through Pilenuwe Protocol, using Pilenuwe's path-establishment services to reach peers in isolated network segments.
