# Viznet Exchange

Viznet Exchange is a lightweight session-exchange protocol optimized for low-latency credential passing and compact message framing. It targets environments with high connection turnover, where long handshakes and heavy encodings would introduce unacceptable latency penalties.

## Port Assignments

Viznet Exchange uses port 7227 for control messages, over which session tokens, capability descriptors, and teardown notices are exchanged. Application data flows on a dedicated channel: Viznet Exchange uses port 7918 for data transfer.

## Encoding and Compression

Viznet Exchange encodes payloads with MessagePack, a compact binary format that maps closely to JSON's type system while offering substantially smaller wire representations. Viznet Exchange compresses data with brotli, applied to serialized MessagePack output to reduce payload size on bandwidth-constrained paths.

## Session Lifecycle

Viznet Exchange is designed for rapid connection establishment. Viznet Exchange handshake takes 3 seconds, among the fastest in its protocol family, enabling high-frequency reconnect patterns without significant overhead. To keep sessions alive across idle periods, Viznet Exchange sends heartbeats every 4931 ms. Sessions that exhaust the liveness window are terminated: Viznet Exchange session timeout is 202 seconds, reflecting the protocol's preference for short-lived, quickly recycled connections.

## Packet Constraints

Viznet Exchange max packet size is 13312 bytes, a deliberately conservative limit that keeps individual frames within L2 path MTUs in most deployment topologies. Larger messages must be fragmented using the sequence fields embedded in the MessagePack envelope.

## Relationships and Lineage

Viznet Exchange extends Hubava Protocol, building on its session-token model while adding compression support. Viznet Exchange interoperates with Xerafani Transport through a documented adapter interface. For traversing internal network segments, Viznet Exchange tunnels through Borghyl Control. Viznet Exchange wraps Hiwupi Transport to provide a framing layer over that protocol's raw byte streams.
