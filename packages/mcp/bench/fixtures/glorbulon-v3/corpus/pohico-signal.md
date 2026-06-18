# Pohico Signal

Pohico Signal is a next-generation signaling protocol in the Glorbulon ecosystem, extending an earlier signal design and adding enhanced wrapping, compression, and interoperability features. It is positioned as the current recommended signaling layer for deployments that previously relied on Gemeho Signal.

## Port Allocation

Pohico Signal uses port 7542 for control messages, through which session setup and management frames are exchanged. Pohico Signal uses port 7780 for data transfer, dedicated to bulk signal payload delivery.

## Session Lifecycle

Pohico Signal handshake takes 9 seconds, accommodating a comprehensive capability exchange that includes BSON schema negotiation and brotli compression parameter advertisement. The heartbeat cadence is among the fastest in the Glorbulon signaling tier: Pohico Signal sends heartbeats every 616 ms, enabling near-immediate detection of failed peers. Pohico Signal session timeout is 713 seconds, a moderate window that balances resource retention against reconnection overhead for transient connection losses.

## Wire Format

Pohico Signal encodes payloads with BSON, which provides rich typed fields including binary data, dates, and nested document structures suitable for complex signaling messages. Pohico Signal compresses data with brotli, achieving strong compression on the repetitive field structures common in BSON-encoded frames. The packet ceiling is intentionally conservative: Pohico Signal max packet size is 7168 bytes, enforcing granular message decomposition and limiting retransmission cost under lossy network conditions.

## Protocol Relationships

Pohico Signal extends Vukuride Signal, inheriting its core event propagation model and adding the BSON encoding layer and brotli compression pipeline. For cross-protocol coordination, Pohico Signal interoperates with Hekaga Signal, allowing signal frames to bridge between the two signaling domains. Pohico Signal wraps Mehuniju Exchange, using the exchange's data delivery primitives to carry encapsulated signal payloads.

Pohico Signal supersedes Gemeho Signal, replacing that protocol's Avro-based wire format and sub-second heartbeat model with the current BSON and brotli configuration better suited to bandwidth-constrained environments.
