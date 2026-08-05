# Topic 2: Connecting sensors to a SensorThings API server (Collaborall)

## Content

This chapter describes the work Collaborall carried out for implementation
topic #2 of the Geonovum Testbed Sensordata 2026: connecting existing
sensors to a central OGC SensorThings API server through an intermediary
translation solution. The solution is available on:

- Connector implementation, full source (Apache-2.0): <https://github.com/collaborall/sta-connector>
- Connector specification (ReSpec): <https://collaborall.github.io/sta-connector/>
- Live demo (connector feeding the central server, available until at least January 2027): <https://sta-connector.collaborall.net>

In summary: Collaborall built **sta-connector**, an open-source,
server-agnostic Python service that ingests observations from
heterogeneous sensor protocols — HTTP, MQTT, Modbus TCP and LoRaWAN via
KPN Things — normalises them to OMS Observations and publishes them to
any OGC SensorThings API v1.1 server over HTTP or MQTT. The connector
ran continuously against our central STA server during the testbed and
also acts as the RQ3 / OpenCitySense control-plane party for remote
device onboarding.

## Scope

Public-sector organisations operate many different sensors — different
vendors, different protocols, different payload formats — and most of
them cannot speak SensorThings natively. Topic 2 asks a participant to
connect one or more existing sensors to a central STA server through an
intermediary translation solution, so that heterogeneous sensors become
available behind one interoperable standard.

## Goal

- Connect existing sensors of different protocols to a central OGC
  SensorThings API server.
- Validate that observations arrive accurately and reliably.
- Document the solution so a third party can reproduce it and onboard
  a new source.
- Provide a continuously available public demonstration.
- Record lessons learned about the standard itself.

## Approach

We built **sta-connector**: an on-premise Python ingest-and-tasking
satellite that receives observations from heterogeneous sources, runs them
through a configuration-driven transform pipeline, and publishes them to
any OGC-conformant SensorThings API server. The connector is deliberately
server-agnostic: it talks pure OGC STA and has been exercised against our
own sta-server implementation.

Where our proposal emphasised BIM object-context enrichment, the delivered
connector emphasises **protocol breadth and transform generality**: HTTP
webhooks, MQTT subscriptions, Modbus polling and LoRaWAN devices via KPN
Things, with a node-graph transform pipeline (byte decoding, unpacking,
unit normalisation) authored in the portal and executed by the connector.
We consider this a strength for the testbed's diversity goal — it answers
"how do you get *any* existing sensor into STA" rather than one vertical.
The ANT platform is capable of the sensor-to-object (FeatureOfInterest)
mapping our proposal described, but that path was not built or tested
within the testbed and is reported as future work.

Architecturally, each configured source has its own asynchronous
pipeline — ingest → validate → normalise → batch → publish — and the
pipeline is identical regardless of the wire protocol on either end:
switching a source from HTTP-in/HTTP-out to MQTT-in/MQTT-out is
configuration, not code. Around the data plane sit a local admin API
(bearer token + optional mutual TLS) through which the portal manages
sources, a Prometheus metrics and health surface, a bounded quarantine
for rejected payloads, and a tasking subscriber that listens on
`v1.1/Tasks/+` (with a polling fallback) and executes the four RQ3
device-management task types (`OnboardDevice`, `OffboardDevice`,
`UpdateConfiguration`, `RotateSecret`). The connector holds a libsodium
keypair and is the only party able to decrypt the `DeviceSecrets` the
server stores as ciphertext. It is designed for a customer's trusted
network with outbound traffic only — no inbound firewall holes.

### Sources connected

| Source | Protocol into the connector | Payload handling |
|---|---|---|
| Dragino LHT52 temperature/humidity (real LoRaWAN hardware) via KPN Things | HTTP webhook (raw SenML) and MQTT | SenML decode → transform graph → OMS Observation |
| Pump pressure (test fleet) | MQTT subscription on the sensor-side broker | JSON decode, unit normalisation |
| Pump (simulator, test fleet) | Modbus TCP polling (holding registers) | Word/byte-order decode → scaling transform |
| Pressure / flow (test fleet) | HTTP push | JSON decode, range validation |

The originally proposed Brabantse Delta / Node-RED source was not
implemented; as agreed with Geonovum, connectivity was validated with
the other sources and testbed connectors instead.

### Configuration model

A source is fully described in YAML: its ingest protocol and parameters,
its transform, its target datastream and its egress protocol. Defaults
(batching, retry schedule) live once and are overridable per source.
Secrets never live in YAML — the configuration only names environment
variables. Transform graphs (byte decoding, unpacking, unit
normalisation) are authored in the portal and executed by the connector.
Sources can also be provisioned at runtime through the admin API, which
is how the portal onboards a new source without YAML edits. The
repository ships an annotated example configuration
(`config/connector.example.yaml`) that doubles as the template for a new
source.

## Validation of accuracy and reliability

Validation took place through sustained operation and open community
testing rather than a one-off measurement campaign. During development
and operation roughly sixteen million observations were ingested
end-to-end (sensor → connector → server), from real hardware (Dragino
LoRaWAN via KPN Things, Netatmo and Milesight devices used by testbed
participants) and the simulated test fleet. All accuracy and
interoperability issues found — by us and by other participants — were
reported, discussed and fixed in the open in
[discussion #10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10),
which serves as the public record of the validation.

Reliability is designed in rather than bolted on: observations are
validated and normalised before publishing, batched with
exponential-backoff retry on network failures, and rejected payloads land
in an inspectable quarantine instead of being silently dropped. Shutdown
drains in-flight observations rather than cancelling them, a property
pinned down by an integration test. The connector distinguishes between
upstream unreachability (retried) and payload rejection (quarantined), so
no failure mode loses data silently.

## Reproducibility

The repository README documents the full quick-start: install
dependencies with `uv sync`, point `CONNECTOR_CONFIG` at a YAML file, set
the bearer token and run. A fully self-contained demo — bundled Mosquitto
broker, the connector, two fake sensors and a subscriber — boots with a
single `make demo-up`. Onboarding a new source requires copying a source
block in the example YAML or one call to the admin API. A clean-room
installation from the public documentation alone was executed
successfully as part of the delivery.

## Public demonstration

The live demonstration at <https://sta-connector.collaborall.net> shows
the connector feeding the central STA server: a visitor sees the
connected sources, their health, and observations arriving in the data
browser as they flow from the sensors through the connector into
<https://sta-server.collaborall.net/v1.1/>. Every observation is
traceable to the source and connector that produced it via the RQ3
`ControllingConnector` relation. The demonstration remains available
until at least January 2027.

## Lessons learned

Detailed engineering notes live in the repository
(`docs/lessons-learned.md`, ADRs). Reported here are our observations on
the **standard itself**, from the perspective of the party operating the
translation layer:

- **Origin and ownership are invisible to the standard.** Once the
  connector has published an Observation, nothing in core STA records
  that this connector produced it, which transform decoded it, or which
  party owns the source. From a client perspective this is our main
  worry about operating STA at scale: managing many servers and many
  connectors at once requires answering "where did this data come from?"
  end to end — for debugging, for deduplication, and for cleaning up
  orphaned sources — and the protocol offers no first-class way to do
  so. The RQ3 / OpenCitySense `ControllingConnector` relation is a
  workable extension, but it is optional and unenforceable without
  breaking spec conformance. We raised this with the testbed community
  in [discussion #16](https://github.com/Geonovum/testbed-sensordata-2026/discussions/16)
  and recommend the standard treat provenance as a first-class concept.
- **The MQTT extension's topic grammar and MQTT wildcards don't
  align.** STA topics put the entity id inside one level
  (`Datastreams(7)/Observations`), so a subscriber cannot use `+` to
  fan out over ids within that shape — `+` matches a whole level, not a
  substring. Subscription patterns therefore end up broader than the
  publish grammar suggests, which the standard could acknowledge.
- **Tasking over MQTT needs a polling fallback.** The
  publish-on-`POST /Tasks` pattern is elegant, but a broker outage would
  otherwise silently stall device onboarding; the standard is silent on
  delivery guarantees. Our connector falls back to polling
  `GET /Tasks?$filter=status eq 'pending'` — onboarding still works,
  with higher latency.
- **Heterogeneity lives entirely on the ingest side.** The STA-facing
  half of the connector is small and uniform; nearly all effort went
  into the sensor-facing half (payload formats, byte orders, broker
  behaviours, platform envelopes — KPN Things delivering raw SenML and
  platform-enveloped payloads for the same device). This is an argument
  *for* the standard: once data is in STA shape, every downstream
  consumer is identical. The translation problem is real but it only has
  to be solved once, at the edge.

## Availability and licensing

The connector and demo remain publicly available until at least January
2027. The connector is open source under **Apache 2.0**; this report
and all documentation deliverables are published under **CC-BY 4.0**.

## Traceability: proposal deliverables → delivered

| Proposal (quotation 30-04-2026)                                                       | Delivered                                                                                                  | Evidence                                                                                                             |
| ---------------------------------------------------------------------------------------| ------------------------------------------------------------------------------------------------------------| ----------------------------------------------------------------------------------------------------------------------|
| Intermediary translation solution connecting existing sensors to a central STA server | Yes                                                                                                        | Source at <https://github.com/collaborall/sta-connector>; Sources connected                                          |
| BIM-aware FeatureOfInterest enrichment via ANT CDE mapping                            | Deliberately re-scoped                                                                                     | Approach section: protocol breadth (MQTT/Modbus/LoRaWAN) delivered instead; ANT capable, path untested — future work |
| Source 1: Brabantse Delta via Node-RED                                                | Not implemented — validated with the other sources and testbed connectors instead, as agreed with Geonovum | Sources connected                                                                                                    |
| Source 2: own sensor set (building context)                                           | Yes                                                                                                        | KPN Things LHT52 (real LoRa hardware) + demo fleet                                                                   |
| Configuration-driven onboarding, template, how-to                                     | Yes                                                                                                        | Configuration model; clean-room install (Reproducibility section)                                                    |
| Validation of accuracy and reliability                                                | Yes                                                                                                        | Validation section; [discussion #10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10)             |
| Public demonstration, continuously available                                          | Yes                                                                                                        | Public demonstration section                                                                                         |
| Open source publication                                                               | Yes — Apache 2.0 as proposed                                                                               | Full source at <https://github.com/collaborall/sta-connector>                                                        |
| CC-BY 4.0 results                                                                     | Yes                                                                                                        | This report                                                                                                          |
| Available ≥ 6 months after testbed (≥ Jan 2027)                                       | Yes                                                                                                        | Live connector + demo                                                                                                |
| Synergy: bi-weekly meetings, open sessions, closing event                             | Yes                                                                                                        | Bi-weekly meetings attended (11:00 on 22-05, 05-06, 19-06, 03-07, 17-07 and 31-07-2026)                              |
| Dissemination: Geonovum repo report, DMI PDX, Best Practice Explorer, blog/LinkedIn   | Partially at delivery                                                                                      | This report; invitation to the final public session is sent to participants in August 2026                           |
