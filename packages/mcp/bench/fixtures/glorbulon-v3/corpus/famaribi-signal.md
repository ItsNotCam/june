# Famaribi Signal

Famaribi Signal is a lightweight signaling protocol in the Glorbulon family, optimized for low-latency event propagation in constrained environments. It replaces Hekaga Signal with a revised handshake model and broader ecosystem integration through standardized authentication and tunneling mechanisms.

## Port Assignment and Transport

Famaribi Signal uses port 7856 for control messages, through which session establishment, keep-alive, and administrative commands are exchanged. Payload delivery occurs on a separate channel: Famaribi Signal uses port 7162 for data transfer, isolating event streams from the control plane to reduce contention.

## Session Parameters

The negotiation phase is brief by design: Famaribi Signal handshake takes 4 seconds, covering mutual capability exchange and credential verification. To detect silently failed peers quickly, Famaribi Signal sends heartbeats every 181 ms — one of the highest heartbeat frequencies in the Glorbulon suite, reflecting its use in time-critical signaling scenarios. Sessions without activity expire promptly; Famaribi Signal session timeout is 195 seconds, keeping resource consumption bounded on edge nodes.

## Encoding and Compression

Famaribi Signal encodes payloads with CBOR, a compact binary representation that reduces parse overhead compared to text-based formats. Bandwidth consumption is further reduced because Famaribi Signal compresses data with brotli, which achieves high compression ratios at the cost of slightly elevated CPU usage during compression. The Famaribi Signal max packet size is 2048 bytes, the smallest in its class, enforcing tight message discipline and discouraging oversized event payloads.

## Protocol Relationships

Famaribi Signal authenticates via Jovekihu Transport, delegating credential validation and key distribution to Jovekihu's established trust infrastructure rather than maintaining its own certificate store.

For cross-framework delivery, Famaribi Signal tunnels through Sewuzeru Framework, making use of Sewuzeru's routing capabilities when direct paths are unavailable. Additionally, Famaribi Signal interoperates with Posewu Exchange through a defined adapter interface that translates Famaribi's signal semantics into Posewu's exchange framing.

## Versioning and Supersession

Famaribi Signal supersedes Hekaga Signal across all production deployments. Migration tooling translates Hekaga session configurations into their Famaribi equivalents automatically, though operators should review heartbeat timing parameters, as the 181 ms interval is substantially tighter than Hekaga's defaults.
