# Topic 2 TUDelft

## Acronyms and Definitions

| Term | Definition |
| ---- | ---------- |
| STA | SensorThings API, specifically v1.1 unless otherwise specified. |
| FROST | Fraunhofer Opensource SensorThings Server, a STA-compliant implementation. |
| Implementor | An individual or group deploying a STA service for a given use case. |
| Thing | Per STA / ITU-T Y.2060: an object of the physical or information world that can be identified and integrated into communication networks. |

## Executive Summary

## 1. Introduction and the Scope of TU Delft's Experiments

Heterogeneity in the Internet of Things (IoT) is a well-documented phenomenon
and a major source of tension when implementing IoT standards such as the
SensorThings API (STA). Devices differ in transport, payload shape, sampling
regimes, identity schemes, and vendor platforms — yet STA expects a coherent
entity graph. Bridging that gap is largely left to the implementor.

The scope of TU Delft's experiments was therefore to explore the tensions that
arise when deploying a network of broadly heterogeneous IoT devices in an
STA-compliant manner. The deployment was made possible by an in-house,
open-source middleware, the
[_Realtime Ingestion and Management Engine_](https://github.com/justinschembri/rime)
(`rime`).

Two packages in `rime` were used during this testbed:

- **`rime-ingest`** — the STA-centric ingestion pipeline that connects to
  upstream providers, transforms payloads, and writes to STA servers; and
- **`rime-client`** — a browser-based STA client for browsing, visualising, and
  downloading data from any STA endpoint.

Following a brief description of the sensor setup in
[Section 2](#2-testbed-technical-summary-iot-providers-networks-and-sensors),
this report focuses on the tensions encountered in
[Section 3](#3-tensions-and-experiences-in-applying-the-sensorthings-api-v11),
the benefits of using STA in [Section 4](#4-benefits-of-using-sta), STA v2
findings in [Section 5](#5-sensorthings-api-v2), and recommendations in
[Section 6](#6-recommendations).

## 2. Testbed Technical Summary: IoT Providers, Networks and Sensors

TU Delft's testbed contribution connected 32 _Things_ to two testbed web
servers implementing
[STA v1.1](https://docs.ogc.org/is/18-088/18-088.html), and to a third server
implementing v2.0, which presently remains a draft. _Thing_ here follows the
STA v2 / ITU-T Y.2060 definition
([ITU-T Y.2060](https://www.itu.int/rec/T-REC-Y.2060-201206-I)):

> A thing is an object of the physical world (physical things) or the
> information world (virtual things) that is capable of being identified and
> integrated into communication networks …

The 32 _Things_ span four unrelated manufacturers and five distinct models,
observe 19 individual Observed Properties, and are located across three
countries.

None of the 32 sensors communicate directly with the STA servers. Each
transmits through an intermediary server, or "provider":

1. An MQTT broker provided by
   [The Things Network](https://www.thethingsnetwork.org/),
2. An HTTP API provided by [Netatmo](https://dev.netatmo.com/),
3. A [SeedLink](https://ds.iris.edu/ds/nodes/dmc/services/seedlink/) server.

Managing this variety was the role of `rime-ingest`, which established contact
with the providers and managed the communication lifecycle. The ingestion
pipeline receives payloads from the various sensors and transforms them in near
real-time into STA-acceptable entities. The transformed payloads are then
pushed to the three STA servers.

| Thing | Description | Provider | Quantity | Countries |
| ----- | ----------- | -------- | -------- | --------- |
| Netatmo NWS03IN | Consumer-grade, Wi-Fi, proprietary indoor weather station. | Netatmo | 3 | Netherlands |
| Milesight AM308L | Professional LoRa indoor air-quality sensor. | The Things Network | 20 | Italy, Romania |
| Kinemetrics ETNA2 | Specialist GPRS seismology accelerometer. | SeedLink | 7 | Romania |
| Dragino LSN50v2-S31 | External LoRa air temperature and humidity sensor. | The Things Network | 1 | Netherlands → Italy |

Table 1 — Summary of _Things_ connected during this testbed.

## 3. Tensions and Experiences in Applying the SensorThings API v1.1

### 3.1 IoT Heterogeneity: Managing Transformation and Ingestion

The message that flows downstream from an IoT device is rarely ready to fit
neatly into STA — or into any other system or standard, for that matter. IoT
heterogeneity goes beyond the shape of the decoded payload: network managers
must contend with variety along the entire network stack.

This challenge is **not** considered a consequence of applying STA, but rather
a general practical reality of the IoT domain. TU Delft's approach was to
develop an ingestion and transformation pipeline abstract enough to handle the
variety of sensors, while focusing entirely on STA compatibility.

Implementors should be aware that STA by no means solves the wider
heterogeneity problem. It does, however, offer a stable baseline and a robust
data model — one that is, in our view, further strengthened in v2. That
baseline makes it possible for developers to build new software products that
handle back-end ingestion and management while remaining out-of-the-box STA
compliant.

> **Recommendation:** Treat STA as the *integration contract*, not as a
> substitute for provider- and model-specific decoding. Budget explicitly for
> an ingestion layer (whether `rime-ingest`, Node-RED, or custom middleware)
> that owns transport, identity, and payload transformation.

### 3.2 The Permanent Identity of a _Thing_

*This issue is largely addressed in STA v2.*

STA does not require that a _Thing_ have a Universally Unique Identifier
(UUID). It is therefore entirely possible to create two identical _Things_,
with the confusion that entails. In STA v1.1 and in this implementation, the
only practical place for a durable identifier was a free-form key in the
`properties` field of the _Thing_, for example:

```json
"properties": {
  "mac_address": "70:ee:50:7f:a8:b3"
}
```

or:

```json
"properties": {
  "dev_eui": "24E124707E427314"
}
```

or:

```json
"properties": {
  "network_station": "RO.TEB11"
}
```

In this deployment, several _Thing_ properties were reasonable unique
identifiers: the Media Access Control (MAC) address for the Netatmo weather
stations, the Device Extended Unique Identifier (DevEUI) for the LoRa
_Things_, and the station code for the seismic stations. The lack of fixed,
standardised keys for these identifiers may undermine interoperability across
systems.

For the ingestion pipeline, such a UUID was critical: it determined which
decoders and transformations to apply, and which existing STA entities an
incoming message should update. Without a stable external identity, the
pipeline cannot reliably reconcile upstream devices with STA _Things_.

> **Recommendation:** Adopt a project-wide convention for identity keys in
> `Thing.properties` (e.g. always `dev_eui`, `mac_address`, or
> `network_station`) and document it. Prefer keys that are already unique in
> the upstream network. Track STA v2 developments that formalise permanent
> identity.

### 3.3 Domain-Specific Canonical Field Enumerations and Value Codes

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
`rime-ingest` was to define a set of *canonical* datastreams that the
transformation pipeline always refers to. Transformation therefore happens at
object creation and is limited to canonical datastream and Observed Property
names.

> **Recommendation:** Define a closed vocabulary of Observed Property and
> Datastream names (and, where possible, `definition` URIs) before ingestion
> begins. Enforce that vocabulary in the pipeline rather than relying on
> operators to choose consistent free-text labels.

### 3.4 Duplication Management

STA does not impose restrictions on the creation of duplicate entities. This
includes "partial" duplicates, where all fields except `@iot.id` are identical
but entity linkages differ — for example, two `ObservedProperty` entities with
identical fields linked to different Datastreams. It also includes full
duplicates, such as identical Observations linked to the same `Datastream`.

Pushing duplicate Observations is a common problem when polling a server for
new readings, and was encountered with the Netatmo HTTP API. The solution
implemented in `rime-ingest` was to check consistently for object existence
before writing to a STA server.

> **Recommendation:** The implementor should be aware that duplicate prevention
> remains their responsibility: STA continues to permit duplicates in both v1
> and v2. Prefer idempotent writes keyed on external identity and
> `phenomenonTime` (or an equivalent natural key).

### 3.5 Equivalence and Identity

Further to the previous issue, STA does not define what constitutes
*equivalence* (equal to) or *identity* (is) between entities. Consider, for
example, two `Location` entities with identical fields, linked to different
`Things`. It is at the discretion of the implementor to decide whether those
Locations are the same place reused, or two coincidentally identical records —
and whether the ingestion layer should merge, reuse, or always create anew.

This decision cascades: equivalence rules for `Sensor`, `ObservedProperty`,
`Location`, and `FeatureOfInterest` determine how aggressively the pipeline
deduplicates, and how portable the resulting graph is across STA servers.

> **Recommendation:** Document explicit equivalence rules per entity type
> before go-live (e.g. "Locations are equal if coordinates and name match";
> "ObservedProperties are equal if `definition` URI matches"). Implement those
> rules in middleware; do not leave them implicit in operator behaviour.

### 3.6 Unassignable Features of Interest

*This issue is resolved in STA v2.*

The `FeatureOfInterest` entity represents the feature being observed by a
sensing entity. For an indoor thermometer, this would be the air inside a given
room. Each Observation is linked to this common Feature of Interest. STA v1.1
links `FeatureOfInterest` exclusively to `Observations`, which creates a
problem for the ingestion pipeline: there is no way to infer which
`FeatureOfInterest` should be assigned to incoming Observations.

Consider a typical multi-sensor setup, where a server receives messages from
several sensors. Each message usually contains some identifying key (e.g. the
MAC address of the device) that can be used to resolve the `Thing` in the
database — provided the identity issue in [§3.2](#32-the-permanent-identity-of-a-thing)
is resolved. From the `Thing`, the system can trace the `Datastreams`, which
generally gives enough information to parse a message and assign an Observation
to the appropriate Datastream. When creating that Observation, however, there
is no way to query the STA system for the appropriate `FeatureOfInterest`,
because STA v1.1 defines no relationship between `FeatureOfInterest` and any
non-Observation entity.

In this testbed, when applying STA v1.1, there was no solution other than
allowing the servers to generate the `FeatureOfInterest` automatically —
essentially cloning the `Location` entity.

> This issue is resolved in the upcoming STA v2, which modifies the
> `FeatureOfInterest` entity extensively: renaming it to `Feature` and linking
> it to `Datastream` as well as to `Observation`.

> **Recommendation:** On v1.1 deployments, decide deliberately whether to
> accept auto-generated Features of Interest or to maintain an
> out-of-band mapping (Thing/Datastream → FoI) in middleware. Prefer STA v2
> where Feature–Datastream linkage is required for correct ingestion.

### 3.7 Modelling Sensor Arrays

All _Things_ in TU Delft's testbed contribution are single physical objects
that contain multiple sensors and are, for practical purposes, indivisible.
This includes, for example, the consumer-grade Netatmo, which measures
temperature, humidity, and pressure in one sealed unit. That differs from
arrangements where sensors are wired to a transmitter or data logger and may
be removed, added, or swapped.

From a modelling perspective, for the sealed multi-sensor case it is acceptable
to treat the device as a single sensing object with multiple Datastreams
(cardinality `1..*`).

> **Recommendation:** Model sealed multi-parameter devices as one `Thing` /
> one `Sensor` with many Datastreams. Reserve a finer Thing/Sensor split for
> deployments where sensing elements are physically swappable or independently
> calibrated.

### 3.8 Usefulness and Definition of Virtual Entities

_Things_ need not be physical objects; they include entities "that are capable
of being identified and integrated into communication networks". This raises
the question of whether a virtual `Thing` may have a virtual `Location`, or
whether it is rather the *absence* of a `Location` that makes a `Thing`
virtual. Irrespective of that question, it remains unclear in which situations
modelling a virtual `Thing` is beneficial.

> **Recommendation:** Introduce virtual Things only when they clarify a real
> operational role (e.g. an algorithm, aggregator, or connector — see
> [§3.11](#311-the-connectors-discussion)). Avoid virtual entities that exist
> solely to fill schema slots; prefer documenting absence (no Location) over
> inventing placeholder Locations.

### 3.9 "Real" and "Derived" Observations

*This issue was discussed on the testbed GitHub repository
([#3](https://github.com/Geonovum/testbed-sensordata-2026/discussions/3)).*

It is common for sensors to transmit data that is not ready for consumption —
for example, readings in voltages or counts. In the simplest cases, linear
arithmetic converts such "raw" figures into "real" observations that represent
the actual `ObservedProperty`. In other cases, complex non-linear functions
may be applied to a timeseries with extensive post-processing to remove noise,
producing an entirely new timeseries.

In both cases, it can be reasonable to treat the initial measurement as the
"real" measurement and the produced observations as *derived*. A counter-
argument, made
[in the same discussion](https://github.com/Geonovum/testbed-sensordata-2026/discussions/3#discussioncomment-17073817),
is that all observations are themselves derivations. Irrespective of that
position, it is **not recommended** to subclass the `Observation` entity (or
any entity) with a convoluted type such as `DerivedObservation`.

Implementors are reminded that virtual Sensors can represent algorithms or
procedures that produce new Datastreams. Such a virtual `Sensor` may be
associated with the "raw" `Datastream` and produce "derived" `Datastreams`.

> **Recommendation:** Decide early whether clients need both raw and derived
> series. If both are required, model derivation as a virtual Sensor (or
> documented procedure) producing separate Datastreams — not as Observation
> subclasses. Record the processing relationship in `properties` or provenance
> metadata so consumers can trace lineage.

### 3.10 Observations as Instants or Arrays

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
first probe the Datastream endpoint, infer the datatype from the response, and
then choose the correct plotting function. That approach is incomplete — any
other result shape (e.g. JSON objects) is also valid in STA.

> **Recommendation:** For complex result types, adopt a fixed object structure
> with predictable keys, especially where plotting or export is required.
> Note that STA v2 introduces a `resultType` on a revised `Datastream` entity,
> which should become the preferred way to advertise result structure to
> clients.

### 3.11 The "Connectors" Discussion

Throughout this testbed, the term *Connectors* appeared in several discussions
(e.g.
[#16](https://github.com/Geonovum/testbed-sensordata-2026/discussions/16)).
The term is taken from Fraunhofer's
[OpenCitySense](https://fraunhoferiosb.github.io/FROST-Server/extensions/DataModel-OpenCitySense.html)
extension, and represents a _Thing_ that manages another _Thing_ — usually a
device. Besides the Connector entity, the OpenCitySense data model also embeds
other virtual components of the IoT lifecycle, such as configurations and
credentials.

The `rime-ingest` package takes a different approach: it does not extend the
STA data model at all. Connectivity, credentials, and provider lifecycle are
managed exclusively by the application layer.

Either way, the discussion reflects a desire to model aspects of the "IoT
back-end", so that an extended STA could participate in more of the IoT
lifecycle. As noted in [§3.1](#31-iot-heterogeneity-managing-transformation-and-ingestion),
middleware such as [Node-RED](https://nodered.org/) is commonly involved in
managing IoT systems. STA has no native Connector concept, and does not appear
designed to own that layer directly; the Connector question therefore remains
open.

> **Recommendation:** Implementors should treat this as an open design choice.
> Prefer keeping credentials and transport configuration *outside* the STA
> graph unless there is a clear requirement for STA-visible management of
> devices. If Connectors (or equivalent) are modelled, document the boundary
> between STA entities and operational secrets carefully.

### 3.12 Extensions and the Future of the Standard

### 3.13 Enforcing Domain Specifics and System Management

## 4. Benefits of Using STA

## 5. SensorThings API v2

## 6. Recommendations

1. Budget for an ingestion layer; STA is the contract, not the decoder.
2. Standardise external identity keys and equivalence rules early.
3. Enforce canonical Observed Property / Datastream vocabularies in middleware.
4. Own duplicate prevention; do not expect the API to do it.
5. Prefer virtual Sensors and separate Datastreams for derived series — not
   Observation subclasses.
6. Advertise complex `result` shapes explicitly; adopt v2 `resultType` when
   available.
7. Keep connectors, credentials, and transport lifecycle outside the core STA
   model unless STA-visible device management is a hard requirement.
8. Track STA v2 for Feature linkage and result typing; plan migration where
   those gaps blocked correct v1.1 ingestion.

