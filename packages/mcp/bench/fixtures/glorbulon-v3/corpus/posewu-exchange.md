# Posewu Exchange

Posewu Exchange is a structured interchange component in the Glorbulon protocol ecosystem, designed for reliable, high-throughput data exchange between cooperating services. It provides a well-defined envelope format and negotiation lifecycle that supports interoperability across multiple framework implementations.

## Port Assignments

Posewu Exchange uses port 7829 for control messages, covering exchange initiation, error reporting, and session lifecycle events. Data flows on a separate channel: Posewu Exchange uses port 7945 for data transfer, which allows independent buffering and scheduling policies to be applied to payload traffic.

## Timing and Reliability

Posewu Exchange sends heartbeats every 3013 ms, a cadence suited to environments where keepalive traffic must be minimized due to network cost or bandwidth constraints. Posewu Exchange session timeout is 353 seconds, reflecting the exchange model's expectation of relatively short-lived, task-bounded interactions rather than indefinitely persistent connections.

## Packet Constraints

Posewu Exchange max packet size is 15360 bytes. Implementations must fragment any payload exceeding this threshold and include sequence metadata sufficient for deterministic reassembly at the remote endpoint.

## Encoding and Compression

Posewu Exchange encodes payloads with MessagePack, providing a compact typed binary format that minimizes serialization overhead for structured exchange records. Posewu Exchange compresses data with gzip to reduce wire size on high-volume exchanges, particularly those carrying repetitive schema-heavy bodies.

## Handshake

Posewu Exchange handshake takes 2 seconds under typical conditions, making it one of the faster initialization sequences in the Glorbulon family. This brevity is achieved by deferring optional capability negotiation to post-handshake extension rounds.

## Relationships

Posewu Exchange interoperates with Plirnode Framework, enabling joint deployments where both components share a common session context. At the implementation level, Posewu Exchange wraps Pebaseko Control to delegate low-level connection management. Identity verification is handled externally: Posewu Exchange authenticates via Vuzugila Control before any privileged exchange operations may proceed. As an evolutionary replacement for an older design, Posewu Exchange supersedes Gufadiso Framework across all supported deployment profiles.
