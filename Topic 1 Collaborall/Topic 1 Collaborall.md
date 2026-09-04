# Topic 1: Hosting a SensorThings API server (Collaborall)

## Content

This chapter describes the work Collaborall carried out for implementation
topic #1 of the Geonovum Testbed Sensordata 2026: hosting a central OGC
SensorThings API server. Part of the work is a from-scratch open-source
server implementation, which is available on:

- Server implementation, full source (Apache-2.0): <https://github.com/collaborall/sta-server>
- Live server (available until at least January 2027): <https://sta-server.collaborall.net/v1.1/>
- Implementation profile & RQ3 device-management extension (ReSpec): <https://collaborall.github.io/sta-server/>
- Admin/demo portal: <https://sta-server.collaborall.net>

In summary: Collaborall built and hosts a **clean-room OGC SensorThings
API v1.1 server** — written directly against the OGC 15-078r6
specification as a PHP / Laravel package on PostgreSQL with TimescaleDB
and PostGIS — rather than deploying an existing implementation. The
server ran throughout the testbed, ingested roughly sixteen million
observations from real and simulated sensors during development, was
exercised by other testbed participants against their own tooling, and
surfaced a series of interoperability findings that only cross-testing
between independent implementations of the standard can reveal.

## Scope

Many public-sector organisations in the Netherlands operate sensors
whose data ends up in vendor-specific silos. The testbed investigates
whether the OGC SensorThings API can serve as the single, standardised
interface for publishing and consuming sensor data. Topic 1 asks a
participant to host a central SensorThings API server that all testbed
sensors can publish to and that any standards-aware client can query.

## Goal

- Host a server implementing the latest OGC SensorThings API (v1.1).
- Offer an OMS-based data model that accommodates all sensors used in
  the testbed, regardless of vendor or protocol.
- Make the deployment reproducible by third parties.
- Demonstrate use-case relevant queries against the live server.
- Record lessons learned about the standard itself.

## Approach

We built and host our own SensorThings API server — a PHP / Laravel
package on PostgreSQL with TimescaleDB (observations hypertable) and
PostGIS (spatial queries) — rather than deploying an existing
implementation. This was a deliberate choice: the testbed's "maximal
learning" objective is served better by an additional, independent
implementation of the standard than by another FROST deployment, and it
surfaced a series of interoperability findings that a
single-implementation ecosystem would never encounter (see Lessons
learned).

The deployment consists of three components:

- **sta-server** — a composer-installable Laravel 12 package
  implementing the STA v1.1 core, a minimal Tasking subset
  (OGC 17-079r1), and the RQ3 / OpenCitySense device-management
  extension.
- **Host application** — a thin Laravel host with an opinionated
  PHP-FPM + nginx Docker layout; PostgreSQL 16 with the TimescaleDB and
  PostGIS extensions.
- **Admin/demo portal** — a Vue 3 single-page application for device
  onboarding, data browsing, and server management, speaking plain STA
  REST to the server.

### Data model (OMS)

The STA v1.1 entity model is itself an encoding of OGC
Observations, Measurements and Samples: Things, Sensors,
ObservedProperties, Datastreams, Observations and FeaturesOfInterest map
one-to-one onto OMS concepts. The server implements this model with a
few points worth noting:

- **Observation types** — Datastreams carry their OMS `observationType`
  (`OM_Measurement`, `OM_TruthObservation`, `OM_CountObservation`, …)
  as OGC-defined URIs, and observation `result` values are validated
  against the declared type.
- **Unitless streams** — for Datastreams without a unit of measurement
  (e.g. `OM_TruthObservation` for passive-infrared detectors) the
  `unitOfMeasurement` sub-keys are `null`, exactly as the specification
  mandates. Our validation was initially stricter than the standard
  here; see Lessons learned.
- **FeatureOfInterest resolution** — when an Observation arrives
  without an explicit FeatureOfInterest, the server auto-resolves it
  from the Thing's Location per the specification.
- **Time-series storage** — Observations live in a TimescaleDB
  hypertable partitioned on `phenomenonTime`, which keeps large
  time-range queries fast without deviating from the STA query
  interface. `phenomenonTime` supports both instants and ISO 8601
  intervals.

### A note on the object-context ambition

Our proposal envisioned linking the OMS `FeatureOfInterest` to a
hierarchical System Breakdown Structure with IFC-based object
definitions managed in ANT CDE. During the testbed we deliberately
shifted that depth toward the ingest side: full MQTT support (both
server-side publish and connector subscriptions) and a multi-protocol
connector programme (HTTP, MQTT, Modbus, LoRaWAN via KPN Things) —
capabilities the tender lists as optional but which proved to be where
the interoperability lessons are. The ANT platform is capable of the
sensor-to-object mapping — the path would link each FeatureOfInterest
to an object node in the ANT CDE breakdown structure, so observations
inherit the asset context (which pump, which bridge deck) of the object
they measure — but we have not built or tested that path within the
testbed, and we report it here as future work rather than a delivered
feature.

## Implementation

The server implements the eight STA v1.1 core entity sets (Things,
Locations, HistoricalLocations, Sensors, ObservedProperties,
Datastreams, Observations, FeaturesOfInterest) with full CRUD, deep
resource paths (`/Datastreams(1)/Observations`, including POST via
navigation paths) and address-to-associated-entity navigation. OData
query options are supported on every collection: `$filter` (comparison,
logical, arithmetic, string and spatial functions, and `phenomenonTime`
interval literals), `$expand` with nested `$select` / `$orderby` /
`$count`, `$select`, `$orderby`, `$top` / `$skip` / `$count`. Errors are
returned in OGC error envelopes.

On top of the core the server ships:

- **MQTT publish** — entity changes and Task creation are published on
  the STA MQTT extension topic shapes (`v1.1/Tasks/{capabilityId}`), so
  connectors react without polling.
- **Tasking subset** (OGC 17-079r1) — `TaskingCapabilities` and `Tasks`.
- **RQ3 / OpenCitySense device-management extension** — `DeviceModels`,
  `Configurations`, `DeviceSecrets` (stored encrypted; the server holds
  ciphertext only) and the `ControllingConnector` / `ControlledDevices`
  relation on Things, following the OpenCitySense naming one-to-one so
  interoperability with FROST-PLUS deployments stays straightforward.
- **Authentication** — Laravel Sanctum bearer tokens with `sta.read` /
  `sta.write` abilities checked on every route.
- **Built-in conformance runner** — asynchronous self-test runs
  triggerable over HTTP (`/v1.1/conformance/runs`), used during
  development to track spec coverage.

Quality evidence: the package carries 925+ Pest tests running against a
real PostgreSQL + TimescaleDB + PostGIS instance (no mocks), static
analysis at PHPStan level max, and formatting/refactoring gates in CI.

## Demonstration: use-case relevant queries

The queries below run against the live server
(<https://sta-server.collaborall.net/v1.1/>; a read token is available
to testbed participants via the portal):

- **Capabilities** — `GET /v1.1/`
- **Time series** — last observations of a datastream, newest first:
  `GET /v1.1/Datastreams(1)/Observations?$orderby=phenomenonTime desc&$top=100`
- **Threshold** — observations above a limit in a time window:
  `GET /v1.1/Observations?$filter=result gt 20 and phenomenonTime ge 2026-07-01T00:00:00Z&$orderby=phenomenonTime desc`
- **Cross-sensor** — all datastreams with their sensor and observed
  property in one call:
  `GET /v1.1/Datastreams?$expand=Sensor($select=name),ObservedProperty($select=name,definition)`
- **Spatial** — things located within an area:
  `GET /v1.1/Locations?$filter=st_within(location, geography'POLYGON ((4.3 51.9, 4.5 51.9, 4.5 52.1, 4.3 52.1, 4.3 51.9))')`
- **Navigation** — a thing with its datastreams and latest observation:
  `GET /v1.1/Things?$expand=Datastreams($expand=Observations($orderby=phenomenonTime desc;$top=1))`

Interoperability with other implementations was validated with the
other testbed connectors and participants publishing to and querying
this server, as agreed with Geonovum; the findings are publicly
documented in
[discussion #10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10).

## Reproducibility

The server is a standard composer package: `composer require
collaborall/testbed-sensordata-server`, publish the config, run the
migrations and `php artisan sta:install`. A self-contained development
environment boots with a single `docker compose up -d` (PostgreSQL 16 +
TimescaleDB + PostGIS). The repository README documents the full
quick-start, configuration surface and auth bootstrap. A clean-room
installation from the public documentation alone was executed
successfully as part of the delivery.

## Lessons learned

Detailed engineering notes live in the repository
(`docs/lessons-learned.md`, ADRs). Reported here are our observations
on the **standard itself**, from the perspective of a party that wrote
an independent implementation of it from the specification:

- **The standard has no notion of origin or ownership.** A `Thing` is
  only a name, a description and a free-form properties map; nothing in
  the protocol records which connector or party produced a Datastream
  or Observation. For an operator managing many servers and connectors
  at once, "where did this data come from?" is not answerable inside
  the standard — devices and datastreams can exist as untraceable
  orphans. The RQ3 / OpenCitySense `ControllingConnector` relation
  fills the gap, but as an optional extension: enforcing it would make
  a server reject spec-conformant entities. We consider provenance a
  first-class concern the standard should address. Raised and discussed
  with the testbed community in
  [discussion #16](https://github.com/Geonovum/testbed-sensordata-2026/discussions/16).
- **The spec constrains objects, not sub-keys — implementers
  over-validate.** OGC 18-088 makes `unitOfMeasurement` mandatory as an
  object but attaches no cardinality to its sub-keys, and explicitly
  requires `null` values for unitless streams. Our initial validation
  required all three sub-keys as strings — stricter than the standard
  and a violation of the `SHALL` for truth-observation streams. The
  general rule we distilled: enforce what the multiplicity column and
  `SHALL`/`SHOULD` notes state; do not invent presence requirements the
  standard leaves open.
- **Value lists are open, not closed enums.** The `observationType`
  URIs read like an enumeration but are not one; FROST accepts informal
  values where we initially required exact OGC URIs. Where the spec is
  silent, matching the de-facto behaviour of the reference
  implementation maximises interoperability — which also means the
  reference implementation's behaviour has quietly become part of the
  standard.
- **Independent implementations are what make it a standard.** The
  SensorThings API has had several implementations over the years —
  FROST, 52°North's sensorweb-server-sta, GOST, and closed-source
  offerings from CubeWerx and SensorUp among them — so ours is by no
  means the second implementation of the standard as such. Within this
  testbed, however, FROST was the only server in use, and cross-testing
  our server against participants' FROST-based tooling surfaced corner
  cases a single-implementation ecosystem never hits: nested `$select` with
  `@iot.id`, string-function argument order (`substringof`),
  `phenomenonTime` interval literals in `$filter`, POST via navigation
  paths, and entity discovery from the capabilities document. All were
  reported, discussed and fixed in the open in
  [discussion #10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10).

## Availability and licensing

The server, portal and data remain publicly available until at least
January 2027. The server implementation is open source under
**Apache 2.0**; this report and all documentation deliverables are
published under **CC-BY 4.0**. The ANT demo environment is provisioned
for testbed participants until the end of 2026.

## Traceability: proposal deliverables → delivered

| Proposal (quotation 30-04-2026)                                                     | Delivered                                                                                      | Evidence                                                                                                    |
| -------------------------------------------------------------------------------------| ------------------------------------------------------------------------------------------------| -------------------------------------------------------------------------------------------------------------|
| Own STA server on Collaborall infrastructure, latest OGC STA                        | Yes                                                                                            | Live server, source at <https://github.com/collaborall/sta-server>, ReSpec profile                          |
| OMS-based data model accommodating all testbed sensors                              | Yes                                                                                            | Data model section above                                                                                    |
| SBS/IFC object hierarchy for FeatureOfInterest (ANT CDE)                            | Partially — deliberately re-scoped                                                             | "A note on the object-context ambition" above; MQTT + multi-protocol depth delivered instead                |
| Interoperability / federation with Brabantse Delta FROST server                     | Not implemented — validated with the other testbed connectors instead, as agreed with Geonovum | Demonstration section; [discussion #10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10) |
| Reproducible documentation, how-to, Docker Compose                                  | Yes                                                                                            | README + clean-room install (Reproducibility section)                                                       |
| Public demo with use-case relevant queries                                          | Yes                                                                                            | Demonstration section                                                                                       |
| Open source publication                                                             | Yes — Apache 2.0 as proposed                                                                   | Full source at <https://github.com/collaborall/sta-server>                                                  |
| CC-BY 4.0 results                                                                   | Yes                                                                                            | This report                                                                                                 |
| Available ≥ 6 months after testbed (≥ Jan 2027)                                     | Yes                                                                                            | Live server; ANT demo environment until end 2026                                                            |
| Demo environment for participants (12 named users)                                  | Yes                                                                                            | Provisioned until end 2026                                                                                  |
| Synergy: bi-weekly meetings, open sessions, closing event                           | Yes                                                                                            | Bi-weekly meetings attended (11:00 on 22-05, 05-06, 19-06, 03-07, 17-07 and 31-07-2026)                     |
| Dissemination: Geonovum repo report, DMI PDX, Best Practice Explorer, blog/LinkedIn | Partially at delivery                                                                          | This report; invitation to the final public session is sent to participants in August 2026                  |
