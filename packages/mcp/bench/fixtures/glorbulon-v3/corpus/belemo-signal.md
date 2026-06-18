# Belemo Signal

Belemo Signal is a rapid-cadence signaling protocol in the Glorbulon family, designed for environments where near-real-time state visibility is critical. Its unusually aggressive heartbeat interval distinguishes it from most sibling protocols and reflects its intended use in latency-sensitive monitoring and control-plane notification scenarios.

## Port Assignments

Belemo Signal uses port 7624 for control messages, carrying connection setup frames, acknowledgment responses, and session teardown notices. Belemo Signal uses port 7289 for data transfer, over which event payloads and state update batches are streamed to registered consumers.

## Session Lifecycle

Belemo Signal handshake takes 3 seconds, during which peers exchange capability vectors and establish shared compression and encoding parameters. After the handshake, liveness monitoring begins immediately: Belemo Signal sends heartbeats every 175 ms, an interval far shorter than most Glorbulon protocols. This aggressive cadence allows detecting peer failure within a fraction of a second, at the cost of higher baseline traffic. If heartbeat acknowledgments stop arriving, Belemo Signal session timeout is 3412 seconds gives the session a generous window before final teardown, smoothing over transient network jitter without triggering expensive reconnections.

## Encoding and Transport

Belemo Signal encodes payloads with CBOR, providing compact binary encoding with native support for typed values and structured maps without a compiled IDL schema. Belemo Signal compresses data with snappy, prioritizing decompression speed so that rapid heartbeat and notification traffic imposes minimal CPU overhead on receivers. Belemo Signal max packet size is 52224 bytes, accommodating burst payloads while keeping individual frames within a manageable size.

## Protocol Relationships

Belemo Signal extends Diforeki Transport, inheriting its underlying framing and flow-control mechanisms while adding the signal-specific notification semantics. Authentication at session establishment is handled externally: Belemo Signal authenticates via Raxaxo Session, which provides credential verification and session key derivation. Where the network path is not directly addressable, Belemo Signal tunnels through Xuxivaxe Layer. For richer payload composition, Belemo Signal wraps Gowowabo Protocol, delegating structured message assembly to that layer.

## Operational Considerations

The 175 ms heartbeat interval generates significant keepalive traffic across large fan-outs. Operators should account for this in bandwidth planning, particularly when Belemo Signal sessions number in the thousands per node.
