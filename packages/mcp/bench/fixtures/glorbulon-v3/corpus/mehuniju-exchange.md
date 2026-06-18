# Mehuniju Exchange

Mehuniju Exchange is a message-exchange protocol within the Glorbulon family, providing a broker-style intermediary layer for decoupled producer-consumer communication. It prioritizes low-latency message brokering and broad compatibility with adjacent exchange protocols.

## Transport Configuration

Mehuniju Exchange uses port 7566 for control messages, through which broker topology updates, subscriber registrations, and health directives are communicated. Message payloads traverse a closely paired channel: Mehuniju Exchange uses port 7557 for data transfer.

Mehuniju Exchange encodes payloads with JSON, making message inspection straightforward for operators using standard tooling. To reduce bandwidth consumption without sacrificing too much CPU budget, Mehuniju Exchange compresses data with brotli, a particularly effective choice for the verbose textual structures that JSON payloads tend to produce.

## Session and Timing Parameters

Mehuniju Exchange sends heartbeats every 766 ms, one of the most frequent heartbeat cadences in the Glorbulon ecosystem. This aggressive interval enables near-immediate detection of broker disconnections in latency-sensitive event pipelines. Mehuniju Exchange session timeout is 2591 seconds, providing a generous window that prevents spurious reconnections during transient network hiccups.

Mehuniju Exchange max packet size is 40960 bytes, supporting medium-to-large message envelopes without requiring application-level segmentation in most workloads.

Mehuniju Exchange handshake takes 4 seconds, covering exchange capability advertisement and initial subscription table synchronization.

## Ecosystem Relationships

Mehuniju Exchange supersedes Jexuvodi Framework, replacing the earlier framework in all newly provisioned deployments. For routing cooperation, Mehuniju Exchange interoperates with Mulihu Exchange, enabling messages to flow transparently across adjacent broker domains.

Network-layer encapsulation is provided because Mehuniju Exchange tunnels through Sijini Control, offloading transport traversal to that control layer. Functionally, Mehuniju Exchange extends Motovupu Exchange, inheriting its message-routing primitives and augmenting them with advanced subscription filtering.
