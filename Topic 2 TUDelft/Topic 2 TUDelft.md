# Topic 2 TUDelft

## Acronyms and Definitions

| Term | Definition |
| ---- | ---------- |
| ETL | Extract, Transform, Load — the pattern of reading data from a source, reshaping it, and writing it to a destination system. |
| STA | [OGC SensorThings API](https://docs.ogc.org/is/18-088/18-088.html), specifically v1.1 unless otherwise specified. A REST-based standard for publishing and querying sensor observations and their metadata. |
| FROST | [Fraunhofer Opensource SensorThings Server](https://github.com/FraunhoferIOSB/FROST-Server), a widely used STA-compliant server implementation. |
| Entity | In STA, a typed object in the data model (e.g. `Thing`, `Sensor`, `Datastream`, `Observation`) with defined properties and relationships to other entities. |
| Thing | Per STA / ITU-T Y.2060: an object of the physical or information world that can be identified and integrated into communication networks — typically the device or platform hosting one or more sensors. |
| Sensor | In STA, the procedure that produces observations (often a physical instrument, but potentially also a human observer or software algorithm). |
| Datastream | In STA, a time series of observations grouped by the same `Thing`, `Sensor`, and `ObservedProperty`. |
| Observation | In STA, a single measured or estimated value at a point or interval in time, linked to a `Datastream` and describing one `ObservedProperty`. |
| ObservedProperty | In STA, the phenomenon being measured (e.g. air temperature, CO₂ concentration). |
| Implementor | An individual or group deploying a STA service and the surrounding ingestion infrastructure for a given use case. |
| Upstream | Further from the STA server and closer to the physical sensing device. The sensor itself is the most upstream component in this report. |
| Downstream | Closer to the STA server and to client applications that consume observations. |
| Provider | An intermediary service between sensors and the STA server that receives device messages and exposes them to consumers — for example an MQTT broker, a vendor HTTP API, or a domain-specific relay such as SeedLink. |
| IoT | Internet of Things. |

**Notation.** Italics (_Thing_) mark the abstract ITU-T / domain concept — a
device or object in the world. Code style (`Thing`, `ObservedProperty`) marks a
concrete STA entity type or field in the data model. Everyday English
("sensor", "observation", "temperature") is left unstyled when the meaning is
generic rather than an STA type name.

## Introduction and the Scope of TU Delft's Experiments

This chapter assumes the reader is already familiar with the basics of the OGC
SensorThings API (STA): its core entities (`Thing`, `Location`, `Sensor`,
`Datastream`, `ObservedProperty`, `Observation`, and `FeatureOfInterest`), and
the idea that clients interact with a STA server through a REST API with
OData-style query parameters. A concise introduction to STA is given in the [report
introduction](#introduction); the [OGC STA v1.1
specification](https://docs.ogc.org/is/18-088/18-088.html) remains the
authoritative reference. Where this chapter goes deeper, it focuses on what an
implementor must decide when connecting real, heterogeneous IoT devices to a
STA server — not on explaining the standard from first principles.

Heterogeneity in the Internet of Things (IoT) is a well-documented phenomenon
and a major source of tension when implementing IoT standards such as STA.
Sensing devices employ a wide range of transports (e.g. HTTP versus MQTT),
payload formats (e.g. JSON versus CSV), sampling regimes (e.g. near-real-time
versus hourly), identity schemes (e.g. MAC address versus DevEUI), and are often
tied to opaque vendor platforms. Yet STA expects a coherent *entity graph*: a
linked set of well-defined objects that a client can traverse and query.

STA is generic by design. At the start of this testbed it was therefore unclear
whether it could absorb that heterogeneity in practice. The scope was to explore
the tensions that arise when deploying a network of heterogeneous IoT devices
against server infrastructure that implements STA. It is important to state what
STA *is not*: it is not a complete software stack for the entire sensing IoT
lifecycle. STA sits further downstream, closer to clients and applications. It
defines a data model, entity relationships, and expected API behaviour, but it
does not prescribe how sensors are provisioned, how raw payloads are decoded, or
how observations travel from a physical probe across networks and intermediary
services into the shape the API expects. That entire upstream path from device
to STA endpoint is duly left to the implementor.

Managing that upstream path is an IoT and extract–transform–load (ETL) problem.
TU Delft addressed it with an in-house, open-source middleware layer, the
[_Realtime Ingestion and Management Engine_](https://github.com/justinschembri/rime)
(`rime`). A full analysis of `rime` is outside the scope of this chapter; the
tensions listed here were surfaced through building and operating it, so a brief
introduction to its role is necessary.

### The `rime` Middleware: IoT Management and ETL Pipeline

Two packages in `rime` were used during this testbed:

- **`rime-ingest`** — the STA-centric ingestion pipeline that connects to
  upstream providers, transforms payloads, and writes to STA servers; and
- **`rime-client`** — a browser-based STA client for browsing, visualising, and
  downloading data from any STA endpoint.

For each connected device, `rime-ingest` performs the following steps in
sequence:

1. **Connect to the provider** — manage communication with an  upstream service
   (e.g. poll an HTTP API or subscribe to an MQTT topic).
2. **Decode the wire format** — decode applied by the
   provider or transport.
3. **Deserialize the payload** — parse the message into an in-memory structure.
4. **Decapsulate to the _Thing_ message** — extract the device-level payload
   from any provider-specific wrapper. The same physical _Thing_ should yield
   equivalent messages regardless of which provider carries them (e.g. a
   different MQTT broker).
5. **Decapsulate to _Sensor_ messages** — split the _Thing_ payload into one or
   more logical sensor readings where a single device exposes multiple
   quantities.
6. **Transform to STA entities** — map each reading to STA `Observation` fields,
   assign canonical `ObservedProperty` and `Datastream` names, and attach the
   correct entity links (`Thing`, `Sensor`, `Datastream`).
7. **Push to STA server(s)** — write the resulting observations to one or more
   STA endpoints (in this testbed, both v1.1 and v2 servers).

Following a brief description of the sensor
[setup](#testbed-technical-summary-iot-providers-networks-and-sensors), this
report focuses on the tensions encountered [in applying the SensorThings
API](#tensions-and-experiences-in-applying-the-sensorthings-api-v11), the
[benefits](#benefits-of-using-sta) of using STA. Altough this testbed required
the deployment of STA v1.1, STA v2 is on the horizon and the implications of
this revision are [explored](#sensorthings-api-v2). Finally, the findings are
condensed as [recommendations](#recommendations).

## Testbed Technical Summary: IoT Providers, Networks and Sensors

TU Delft's testbed contribution connected 31 _Things_ to two testbed web servers
implementing [STA v1.1](https://docs.ogc.org/is/18-088/18-088.html), and to a
third, development server implementing v2.0, as implemented by the two Topic 1
developers earlier in this report.

As a reminder, _Thing_ here follows the
[ITU-TY.2060](https://www.itu.int/rec/T-REC-Y.2060-201206-I) definition adopted
by both STA v1.1 and v2:

> A thing is an object of the physical world (physical things) or the
> information world (virtual things) that is capable of being identified and
> integrated into communication networks …

The 31 _Things_ span four unrelated vendors and four distinct sensor models. In
total, these sensors observe 19 different `ObservedProperties`, and are located
across three countries.

None of the 31 sensors communicate directly with the STA servers. Each
transmits through an intermediary provider:

1. An MQTT broker provided by
   [The Things Network](https://www.thethingsnetwork.org/),
2. An HTTP API provided by [Netatmo](https://dev.netatmo.com/),
3. A [SeedLink](https://ds.iris.edu/ds/nodes/dmc/services/seedlink/) server,

| Thing | Description | Provider | Quantity | Countries |
| ----- | ----------- | -------- | -------- | --------- |
| Netatmo NWS03IN | Consumer-grade, Wi-Fi, proprietary indoor weather station. | Netatmo | 3 | Netherlands |
| Milesight AM308L | Professional LoRa indoor air-quality sensor. | The Things Network | 20 | Italy, Romania |
| Kinemetrics ETNA2 | Specialist GPRS seismology accelerometer. | SeedLink | 7 | Romania |
| Dragino LSN50v2-S31 | External LoRa air temperature and humidity sensor. | The Things Network | 1 | Netherlands → Italy |

Table 1 — Summary of _Things_ connected during this testbed.

## Tensions and Experiences in Applying the SensorThings API v1.1

In the upcmoing subsections, the encountered tensions are elaborated on. Where
possible, recommendations are made and links are provided to Github discussions
which run adjacent to the topic.

### IoT Heterogeneity: Managing Transformation and Ingestion

The message that flows downstream from an IoT device is rarely ready to fit
neatly into STA — or into any other system or standard, for that matter. IoT
heterogeneity goes beyond the shape of the decoded payload: network managers
must contend with variety along the entire network stack.

This challenge is **not** considered a consequence of applying STA, but rather
a general practical reality of the IoT domain. TU Delft's approach was to
develop an ingestion and transformation pipeline abstract enough to handle the
variety of sensors, while focusing entirely on STA compatibility.

Implementors should be aware that STA by no means solves the wider heterogeneity
problem. It does, however, offer a stable baseline, a robust data model — one
that is, in our view, further strengthened in v2. That baseline makes it
possible for developers to build and manage software products that handle
back-end ingestion and management while remaining out-of-the-box STA compliant.

> **Recommendation:** Treat STA as the integration target and an
> interoperability contract, not as a substitute for provider and model-specific
> management. Budget explicitly for an ingestion layer (whether `rime-ingest`,
> Node-RED, or any other middleware) that owns transport, identity, and payload
> transformation.

### The Permanent Identity of a _Thing_ and _Sensor_

*This issue was discussed on the testbed GitHub repository
([#12](https://github.com/Geonovum/testbed-sensordata-2026/discussions/12)).*

*This issue is **partially** addressed in STA v2.*

STA assigns every entity a service-local identifier (`@iot.id` in v1.1, `id` in
v2). That value uniquely identifies a record *within one server*, but it is not
a durable external identity: it is typically server-generated, and the same
physical device will receive a different `@iot.id` if recreated or published to
another STA instance. The standard does not require a Universally Unique
Identifier (UUID), DevEUI, MAC address, or similar key on `Thing` or `Sensor`.
Without a project convention, it is therefore easy to create two `Things` (or
`Sensors`) that represent the same physical device — with the confusion,
metadata drift, and fragmented timeseries that follow.

In STA v1.1 the usual place for a durable key, if required, is an unconstrained
entry in `properties`, for example on the `Thing`:

```json
"properties": {
  "mac_address": "70:ee:50:7f:11:11"
}
```

or:

```json
"properties": {
  "dev_eui": "24E124707E421111"
}
```

or:

```json
"properties": {
  "network_station": "RO.TEB11"
}
```

In the TU Delft deployment, however, *sensor* identity mattered more than
*thing* identity for ingestion. `rime-ingest` chooses decoders, deserializers,
and parsers from the identity of the upstream sensing device — the component
that produces the payload — not from the platform that hosts it. The implemented
convention was therefore to place a stable, unique external key in the `name`
field of the `Sensor` (MAC address for Netatmo stations, DevEUI for LoRa
devices, station code for seismic instruments).

That choice has a modelling consequence. In STA, `Thing` and `Sensor` are not
linked directly: each `Datastream` points to exactly one of each, and a single
`Sensor` may be reused across many `Datastreams` (and thus, indirectly, across
many `Things`). That reuse is how STA supports treating `Sensor` as a *type* or
procedure — for example one shared “DHT22” `Sensor` linked to many devices. By
putting a per-device UUID in `Sensor.name`, `rime` instead treated each `Sensor`
as an *instance* identity. The pipeline can then resolve an incoming message to
a unique `Sensor` (and from there to its `Datastreams`) without relying on a
shared type catalogue. The trade-off is that `Sensor` no longer behaves as a
reusable abstract type; it carries the same kind of instance-level uniqueness
assignable to a `Thing`. That is a valid modelling choice, but it
is a deliberate departure from the Sensor-as-type pattern that STA also permits.

The lack of standardised key names (`dev_eui` versus `deveui` versus
`DevEUI`, and whether the key lives on `Thing.properties`, `Sensor.properties`,
or `Sensor.name`) still undermines cross-system interoperability. STA v2
partially helps by adding an optional `definition` URI to most entities,
including `Thing` and `Sensor`, intended as a link to an external authoritative
identifier — but it still does not mandate a particular scheme.

> **Recommendation:** Decide early whether durable identity lives primarily on
> the `Thing`, the `Sensor`, or both, and document a project-wide key
> convention (e.g. always `dev_eui`, `mac_address`, or `network_station`). Prefer
> keys that are already unique in the upstream network. If middleware routes on
> sensor identity — as `rime-ingest` does — put that key where the pipeline can
> query it reliably (`Sensor.name`, `Sensor.properties`, or v2 `definition`).
> Be explicit whether `Sensor` is modelled as a reusable *type* or as a
> per-device *instance*; mixing the two silently is a common source of
> duplicates. Track STA v2 `definition` for cross-service identity, but do not
> expect it alone to replace a documented convention.

### Domain-Specific Canonical Field Enumerations and Value Codes

STA v1.1 is a generic standard that imposes few limits on the user. That is
likely a feature, not a bug — but users should be aware that, within certain
domains, it may be desirable to further restrict the inputs of certain entity
fields.

Consider, for example, the entity `ObservedProperty`, which specifies the
phenomenon of an `Observation` and has the following fields:

```
name: CharacterString
definition: URI
description: CharacterString
properties: JSON Object [0..1]
```

Without enforced categories for any of these fields, a database can easily
accumulate semantically identical objects under different names. STA is
extensible, and additional enumerations can be imposed. The approach taken in
`rime-ingest` was to define a set of *canonical* `Datastreams` that the
transformation pipeline always refers to. Transformation therefore happens at
object creation and is limited to canonical `Datastream` and `ObservedProperty`
names.

> **Recommendation:** Define a closed vocabulary of `ObservedProperty` and
> `Datastream` names (and, where possible, `definition` URIs) before ingestion
> begins. Enforce that vocabulary in the pipeline rather than relying on
> operators to choose consistent free-text labels.

### Duplication Management

STA does not impose restrictions on the creation of duplicate entities. This
includes "partial" duplicates, where all fields except `@iot.id` are identical
but entity linkages differ — for example, two `ObservedProperty` entities with
identical fields linked to different `Datastreams`. It also includes full
duplicates, such as identical `Observations` linked to the same `Datastream`.

Pushing duplicate `Observations` is a common problem when polling a server for
new readings, and was encountered with the Netatmo HTTP API. The solution
implemented in `rime-ingest` was to check consistently for object existence
before writing to a STA server. To reduce the overhead of an existence check for
polling type transports, the last message from a given `Sensor` is kept cached
in memory and and the comparsion happens locally, reducing the need for a
redunant round trip. 

> **Recommendation:** The implementor should be aware that duplicate prevention
> remains their responsibility: STA continues to permit duplicates in both v1
> and v2. Prefer idempotent writes keyed on external identity and
> `phenomenonTime` (or an equivalent natural key), or accept duplication risk
> and carry out periodic de-duplication prunes.

### Equivalence and Identity

Further to the previous issue, STA does not define what constitutes
*equivalence* (equal to) or *identity* (is) between entities. Consider, for
example, two `Location` entities with identical fields, linked to different
`Things`. It is at the discretion of the implementor to decide whether those
`Locations` are the same place reused, or two coincidentally identical records —
and whether the ingestion layer should merge, reuse, or always create anew.

This decision cascades: equivalence rules for `Sensor`, `ObservedProperty`,
`Location`, and `FeatureOfInterest` determine how aggressively the pipeline
deduplicates, and how portable the resulting graph is across STA servers.

> **Recommendation:** Document explicit equivalence rules per entity type
> before go-live (e.g. "`Locations` are equal if coordinates and name match";
> "`ObservedProperties` are equal if `definition` URI matches"). Implement those
> rules in middleware; do not leave them implicit in operator behaviour.

### Unassignable Features of Interest

*This issue is resolved in STA v2.*

The `FeatureOfInterest` entity represents the feature being observed by a
sensing entity. For an indoor thermometer, this would be the air inside a given
room. Each `Observation` is linked to this common `FeatureOfInterest`. STA v1.1
links `FeatureOfInterest` exclusively to `Observations`, which creates a
problem for the ingestion pipeline: there is no way to infer which
`FeatureOfInterest` should be assigned to incoming `Observations`.

Consider a typical multi-sensor setup, where a server receives messages from
several sensors. Each message usually contains some identifying key (e.g. the
MAC address of the device) that can be used to resolve the `Sensor` in the
database — provided the identity issue in [discussed
earlier](#the-permanent-identity-of-a-thing-and-sensor) is resolved. From the
`Sensor`, the system can trace the `Datastreams`, which generally gives enough
information to parse a message and assign an `Observation` to the appropriate
`Datastream`. When creating that `Observation`, however, there is no way to
query the STA system for the appropriate `FeatureOfInterest`, because STA v1.1
defines no relationship between `FeatureOfInterest` and any non-`Observation`
entity.

In this testbed, when applying STA v1.1, there was no practical solution other
than relying on server-side convenience behaviour, which auto-generates a
`FeatureOfInterest` from the `Location` of the `Thing` when none is supplied
with the `Observation`. Note that this auto-generation is a server feature,
concindentally implemented by both Topic 1 participants, not a requirement of
the STA standard itself.

> This issue is resolved in the upcoming STA v2, which modifies the
> `FeatureOfInterest` entity extensively: renaming it to `Feature` and linking
> it to `Datastream` as well as to `Observation`.

> **Recommendation:** On v1.1 deployments, decide deliberately whether to
> accept auto-generated `FeaturesOfInterest` or to maintain an
> out-of-band mapping (`Thing`/`Datastream` → `FeatureOfInterest`) in middleware.
> Prefer STA v2 where `Feature`–`Datastream` linkage is desirable.

### Modelling Sensor Arrays

All _Things_ in TU Delft's testbed contribution are single physical objects
that contain multiple sensors and are, for practical purposes, indivisible.
This includes, for example, the consumer-grade Netatmo, which measures
temperature, humidity, and pressure in one sealed unit. That differs from
arrangements where sensors are wired to a transmitter or data logger and may
be removed, added, or swapped.

From a modelling perspective, for the sealed multi-sensor case it is acceptable
to treat the device as a single sensing object with multiple `Datastreams`
(cardinality `1..*`).

> **Recommendation:** Model sealed multi-parameter devices as one `Thing` /
> one `Sensor` with many `Datastreams`. Reserve a finer `Thing`/`Sensor` split
> for deployments where sensing elements are physically swappable or
> independently calibrated.

### Usefulness and Definition of Virtual Entities

_Things_ need not be physical objects; they include entities "that are capable
of being identified and integrated into communication networks". This raises
the question of whether a virtual `Thing` may have a virtual `Location`, or
whether it is rather the *absence* of a `Location` that makes a `Thing`
virtual. Irrespective of that question, it remains unclear in which situations
modelling a virtual `Thing` is beneficial and if the differentation should be
made explicitly or implicitly.

> **Recommendation:** Introduce virtual `Things` only when they clarify a real
> operational role (e.g. an algorithm, aggregator, or connector — see
> [here](#the-connectors-discussion)). Avoid virtual entities that exist solely
> to fill schema slots; prefer documenting absence (no `Location`) over
> inventing placeholder `Locations`.

### "Real" and "Derived" Observations

*This issue was discussed on the testbed GitHub repository
([#3](https://github.com/Geonovum/testbed-sensordata-2026/discussions/3)).*

It is common for sensors to transmit data that is not ready for consumption —
for example, readings in voltages or counts. In the simplest cases, linear
arithmetic converts such "raw" figures into "real" observations that represent
the actual `ObservedProperty`. In other cases, complex non-linear functions
may be applied to a timeseries with extensive post-processing to remove noise,
producing an one or more entirely new timeseries.

In both cases, it can be reasonable to treat the initial measurement as the
"real" measurement and the produced observations as *derived*. A counter-
argument, made
[in the same discussion](https://github.com/Geonovum/testbed-sensordata-2026/discussions/3#discussioncomment-17073817),
is that all observations are themselves derivations. Irrespective of that
position, it is not recommended to subclass the `Observation` entity (or
any entity) with a convoluted type such as `DerivedObservation`.

Implementors are reminded that virtual `Sensors` can represent algorithms or
procedures that produce new `Datastreams`. Such a virtual `Sensor` may be
associated with the "raw" `Datastream` and produce "derived" `Datastreams`.

> **Recommendation:** Decide early whether clients need both raw and derived
> series. If both are required, model derivation as a virtual `Sensor` (or
> documented procedure) producing separate `Datastreams` — not as `Observation`
> subclasses. Record the processing relationship in `properties` or provenance
> metadata so consumers can trace lineage.

### Observations as Instants, Arrays or Any

*This issue was discussed on the testbed GitHub repository
([#15](https://github.com/Geonovum/testbed-sensordata-2026/discussions/15)).*

*This issue is largely addressed in STA v2.*

The Netatmo, Milesight, and Dragino sensors used in TU Delft's contribution
observe every five to ten minutes. That regime lends itself to modelling
`Observations` as point-in-time measurements, where `result` and
`phenomenonTime` are scalar values. Conversely, the Kinemetrics sensor samples
at 100 Hz. Creating one `Observation` per sample is both contrary to waveform
practice and a significant load on the STA and database servers.

STA does allow the `result` of an `Observation` to be of type `ANY`. Each
Kinemetrics `Observation` therefore uses an array-typed result, with each
result holding five minutes of samples, down-sampled to 2 Hz for storage.

Different result types created issues for `rime-client`, which initially
expected scalar results and could not unpack arrays. The client fix was
relatively straightforward but incurs a small performance cost: the client must
first probe the `Datastream` endpoint, infer the datatype from the response, and
then choose the correct plotting function. That approach is incomplete — any
other result shape (e.g. JSON objects) is also valid in STA.

> **Recommendation:** For complex result types, adopt a fixed object structure
> with predictable keys, especially where plotting or export is required.
> Note that STA v2 introduces a `resultType` on a revised `Datastream` entity,
> which should become the preferred way to advertise result structure to
> clients.

### The "Connectors" Discussion

Throughout this testbed, the term *Connectors* appeared in several discussions
(e.g.
[#16](https://github.com/Geonovum/testbed-sensordata-2026/discussions/16)).
The term is taken from Fraunhofer's
[OpenCitySense](https://fraunhoferiosb.github.io/FROST-Server/extensions/DataModel-OpenCitySense.html)
extension, and represents a `Thing` that manages another `Thing` — usually a
device. Besides the Connector entity, the OpenCitySense data model also embeds
other virtual components of the IoT lifecycle, such as configurations and
credentials.

The `rime-ingest` package takes a different approach: it does not extend the
STA data model at all. Connectivity, credentials, and provider lifecycle are
managed exclusively by the application layer.

Either way, the discussion reflects a desire to model aspects of the "IoT
back-end", so that an extended STA could participate in more of the IoT
lifecycle. As noted in
[earlier](#iot-heterogeneity-managing-transformation-and-ingestion), middleware
such as [Node-RED](https://nodered.org/) is commonly involved in managing IoT
systems. STA has no native connector concept, and does not appear designed to
own that layer directly; the connector question therefore remains open.

> **Recommendation:** Implementors should treat this as an open design choice.
> Keeping credentials and transport configuration *outside* the STA graph is an
> option, unless there is a clear requirement for STA-visible management of
> devices. If Connectors (or equivalent) are modelled, document the boundary
> between STA entities and operational secrets carefully.

### Extensions and the Future of the Standard

*This issue was discussed on the testbed GitHub repository
([#16](https://github.com/Geonovum/testbed-sensordata-2026/discussions/16),
[#10](https://github.com/Geonovum/testbed-sensordata-2026/discussions/10)).*

Presently STA v1 includes the
[STAplus](https://docs.ogc.org/is/22-022r1/22-022r1.html) and the [WebSub
Asynchronous Messaging Standard](https://docs.ogc.org/is/24-032r1/24-032r1.html)
extensions. The former extends the data model to include concepts of ownership
(see [STAplus 1.0](https://docs.ogc.org/is/22-022r1/22-022r1.html)),
especially with respect to multi-user contributions such as citizen science
projects; while the latter is a technical extension allowing users to subscribe
to a STA endpoint and receive notification when the result of an
arbitrary query changes. These extensions were not used by TU Delft during this
testbed.

In this testbed, the Fraunhofer STA implementation (FROST) came loaded with
several non-standard management and quality-of-life extensions implemented as
plugins. While TU Delft did not make direct use of any of these plugins due to
time constraints, it was apparent during public discussions that some issues
encountered during this testbed are at least partially addressed by them.

Of note was the
[_Projects_](https://fraunhoferiosb.github.io/FROST-Server/extensions/DataModel-Projects.html)
plugin, which introduces `Users`, `Roles`, and `Projects` to the data model,
facilitating the management of boundaries between various groups pushing to a
common STA server — as was the case in this testbed. The
[OpenCitySense](https://fraunhoferiosb.github.io/FROST-Server/extensions/DataModel-OpenCitySense.html)
plugin on the other hand extended the data-model to allow for management of
various aspects of the IoT such as sensor configurations and Connectors.
OpenCitySense differs from the approach used by `rime`, which opted not to
extend the data model in favour of a predominantly file-based, "GitOps"
approach to management.

The absence of standardised management extensions is considered noteworthy,
and throughout this testbed we perceived that each Topic 2
participant was developing their own management approaches. The approaches
implemented by several partners appeared to have enough similarities to merit
the idea that some common standard could serve the various deployments.

> **Recommendation:** Standardised management extensions to the core STA could
> allow for the development of management systems, portals and interfaces that
> do away with the need for middleware and reduce deployment tensions. This
> issue is a SWG issue rather than an implementor's issue.

## Benefits of Using STA

Irrespective of the relatively minor tensions described in the earlier section,
STA, from our perspective as implementors, proved to be an effective standard
for the management of our networks. The most notable gain vis-à-vis
interoperability was seen in the development of the consumer-facing
`rime-client`
([#9](https://github.com/Geonovum/testbed-sensordata-2026/discussions/9)),
which was able to serve results from multiple, unconnected STA servers simply
by changing the target endpoint.

Consider client functionalities such as health-checks, which can leverage the
OData-style querying built into the standard. A health-check was conceived as
a query to each `Datastream`, requesting the temporal extent (and thereby the
time of the most recent `Observation`)
([#14](https://github.com/Geonovum/testbed-sensordata-2026/discussions/14)).
Consider the STA service at
https://airquality-frost.k8s.ilt-dmz.iosb.fraunhofer.de/v1.1/, which allows
for this relatively complex query through a single URL:

```url
https://airquality-frost.k8s.ilt-dmz.iosb.fraunhofer.de/v1.1/Datastreams?
    $select=phenomenonTime,@iot.id
    &$expand=Thing($select=@iot.id)
    &$top=10000
```

Which returns:

```url
{
"value": [
    {
    "phenomenonTime": "2017-12-31T23:00:00Z/2026-06-10T07:00:00Z",
    "@iot.id": 1,
    "Thing": {
    "@iot.id": 165
    }
        },
    {
    "phenomenonTime": "2017-12-31T23:00:00Z/2026-06-10T07:00:00Z",
    "@iot.id": 2,
    "Thing": {
    "@iot.id": 165
    },
    ...
}
```

The query and result remained consistent and functionally valid across multiple
STA servers. The client was similarly capable of displaying and placing all
`Things` of a STA instance on a [Leaflet](https://leafletjs.com/) map using the
query:

```url
https://airquality-frost.k8s.ilt-dmz.iosb.fraunhofer.de/v1.1/Things?
    $expand=Locations
    &$top=10000
```

In the above URL, the `$expand` parameter was shown to be highly effective,
allowing the return of related entities from a parent entity.

The client may request the latest `Observation` value for a given `Datastream`
via:

```url
https://airquality-frost.k8s.ilt-dmz.iosb.fraunhofer.de/v1.1/Datastreams(18824)
    /Observations?
    $top=1
    &$orderby=phenomenonTime desc
```

... and may return any number of observations, say, for plotting by changing the
value passed to `$top`.

The STA data model is lightweight but was found to be adequately flexible.
Provided that implementors enforce some internal conformity on their data
structures, much domain complexity can be achieved by simply _soft-typing_
certain fields such as `properties`. Besides the issue with regard to
`FeatureOfInterest` discussed in
[Unassignable Features of Interest](#unassignable-features-of-interest),
navigating the data model effectively was straightforward.

## SensorThings API v2

The targeted versions of STA were v1.0 and v1.1. STA v2, however, is known to
be on the horizon and was up for OGC member voting at the time of writing. The
process appears to be nearing its conclusion, so much so that the Fraunhofer
IOSB FROST server's [v2.8 development
snapshot](https://hub.docker.com/r/fraunhoferiosb/frost-server?tag=develop-2.x-2.8.0-SNAPSHOT)
already includes support for v2. STA v2 updates the data model and the typing
of some fields, and is thus a breaking (or "major") revision, although the
spirit of the standard remains relatively unchanged.

Several implementation tensions described in this document are targeted by
STA v2, most notably the issue pertaining to
[unassignable features of interest](#unassignable-features-of-interest), which
is completely addressed, and
[The Permanent Identity of a _Thing_ and _Sensor_](#the-permanent-identity-of-a-thing-and-sensor),
which is partially addressed.

The former is resolved by a modification to the data model that links `Feature`
(renamed from `FeatureOfInterest`) directly to `Datastream`. The latter is
partly mitigated by introducing an optional `definition` field to most entities,
including `Thing`, which allows users to store a URI linking the entity to an
external, authoritative source. This helps cross-service identification, though
it does not mandate a specific identity scheme such as a UUID or DevEUI.

During this testbed a public STA v2 server was [made
available](https://github.com/Geonovum/testbed-sensordata-2026/discussions/17).
The `rime-ingest` pipeline was
[modified](https://github.com/justinschembri/rime/pull/105) to support v2 of
STA. The modifications to the pipeline were simple, albeit non-trivial. The
structure of the configuration files used to construct the initial STA entities
differed, unsurprisingly, between the two versions, which led to configuration
drift.

While the ingestion pipeline did successfully and simultaneously push to both
v1.1 and v2 STA instances from the same providers, the two versions remain
incompatible. We therefore do not recommend running parallel versions unless
absolutely necessary, considering that migration does not, in our opinion,
appear to be a significant challenge; `rime-client`, for example, supports v1,
v1.1, and v2 with an almost identical codebase.

From our experience as implementors, STA v2 offers many benefits over v1.1,
especially with regard to extended OData-style querying — such as a richer
`$filter` option set — as well as the resolution of some tensions described in
this document.

> **Recommendation:** Implementors should be aware of the upcoming STA v2,
> which addresses some tensions described in this document and includes other
> major improvements that are out of scope to describe here. From our
> experience, migration between versions is not a major overhead but is
> certainly involved. We recommend that implementors choose deliberately
> between versions, and we recommend v2.

## Recommendations

The following recommendations are addressed to implementors of STA:

1. **Budget for an ingestion layer.** STA is the integration contract, not the
   IoT manager or the decoder. FROST plugins such as _Projects_ and
   _OpenCitySense_ can help with management, but they are not standardised.
2. **Standardise external identity and equivalence early.** Document where
   durable keys live (`Thing`, `Sensor`, or both) and which key names to use.
   Decide explicitly whether `Sensor` is a reusable *type* or a per-device
   *instance* — and do not mix the two silently. Document equivalence rules per
   entity type before go-live.
3. **Enforce canonical vocabularies in middleware, or by extending the
   datamodel.** Close the set of `ObservedProperty` and `Datastream` names (and,
   where possible, `definition` URIs) rather than relying on free-text labels.
4. **Own duplicate prevention.** Do not expect the API to do it; prefer
   idempotent writes keyed on external identity and `phenomenonTime`.
5. **Model sealed multi-parameter devices simply.** Prefer one `Thing` / one
   `Sensor` / many `Datastreams`. Reserve a finer `Thing`/`Sensor` split for
   deployments where sensing elements are physically swappable or independently
   calibrated.
6. **Decide a v1.1 `FeatureOfInterest` strategy.** Accept FROST auto-generation
   from `Location`, or maintain an out-of-band `Thing`/`Datastream` →
   `FeatureOfInterest` map in middleware. Prefer STA v2 where
   `Feature`–`Datastream` linkage is required.
7. **Prefer virtual `Sensors` and separate `Datastreams` for derived series** —
   not `Observation` subclasses. Record lineage in `properties` or provenance
   metadata.
8. **Advertise complex `result` shapes explicitly.** Adopt a fixed object
   structure for arrays and composites; use v2 `resultType` when available.
9. **Keep connectors, credentials, and transport lifecycle outside the core STA
   model** unless STA-visible device management is a hard requirement.
10. **Use `Datastream.phenomenonTime` for health-checks** rather than nested
    “latest `Observation`” expands — it is far cheaper and is what the field is
    for.
11. **Validate against more than one STA implementation.** Behaviour can differ
    on `observationType`, `unitOfMeasurement`, filters, and related edges;
    testing only against FROST (or only against one commercial server) hides
    interoperability gaps.
12. **Choose one STA version deliberately; prefer v2.** Do not run v1.1 and v2
    in parallel unless absolutely necessary. Plan migration where v1.1 gaps
    (`Feature` linkage, result typing, external `definition`) blocked correct
    ingestion.

