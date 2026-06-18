# Lohoxoso Protocol

Lohoxoso Protocol is a general-purpose communication protocol in the Glorbulon ecosystem, designed to mediate data exchange between heterogeneous service tiers with a strong emphasis on schema-enforced payloads and flexible compression.

## Transport Configuration

Lohoxoso Protocol uses port 7763 for control messages, through which session lifecycle commands, negotiation frames, and administrative messages are routed. Application data moves on a distinct port: Lohoxoso Protocol uses port 7636 for data transfer.

Lohoxoso Protocol encodes payloads with Avro, leveraging that format's schema evolution capabilities to allow rolling upgrades without coordinated downtime across connected services. For wire compression, Lohoxoso Protocol compresses data with brotli, achieving high compression ratios particularly well-suited to JSON-like structured payloads within Avro containers.

## Session and Timing Parameters

Lohoxoso Protocol sends heartbeats every 3298 ms, keeping peer liveness information current while limiting the heartbeat overhead to a manageable fraction of available bandwidth. If no successful activity is observed, Lohoxoso Protocol session timeout is 2303 seconds, after which stale session state is reclaimed by the connection manager.

Lohoxoso Protocol max packet size is 39936 bytes, accommodating medium-scale records that would otherwise require fragmentation at lower protocol layers.

For initial setup, Lohoxoso Protocol handshake takes 5 seconds, during which endpoints exchange schema registries and negotiate compression parameters.

## Ecosystem Relationships

Lohoxoso Protocol depends on Mehidu Control for session authorization and rate-throttling directives. As a protocol extension, Lohoxoso Protocol extends Jaduwesa Signal, inheriting its event-delivery semantics and adding richer framing conventions.

Network-layer traversal is accomplished because Lohoxoso Protocol tunnels through Famaribi Signal, delegating transport encapsulation to that signal layer. For cross-domain data routing, Lohoxoso Protocol interoperates with Vuwiposu Signal, enabling seamless message bridging between adjacent protocol domains.
