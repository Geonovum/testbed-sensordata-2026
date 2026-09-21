## Abstract
This is the 2026 Geonovum testbed sensordata report. It contains the results of Geonovum's investigation into OGC sensordata standards. This was done with market participation. Using a public tender process, five parties were selected to perform 6 implementation topics:

* Fraunhofer IOSB: Hosting a SensorThings API server

* Collaborall: Hosting a SensorThings API server, and Connecting sensors to a SensorThings API server

* Clappform: Connecting sensors to a SensorThings API server

* Geo Insights: Connecting sensors to a SensorThings API server

* TUDelft: Connecting sensors to a SensorThings API server

This report contains their detailed findings.

Geonovum's conclusion is that the SensorThings API is a strong candidate for a
mandatory standard, but not on its own. The testbed showed that the entity model
is easy to implement, including in domains it had never been applied to before,
and that it delivers interoperability in practice: one participant connected to
another's server in a matter of days, with no documentation, no schema and no
contact with the other party's engineers. Conforming to the standard turned out
to be by far the cheapest part of the work, because harmonisation only has to be
solved once, at the point of ingestion.

What the standard does not give you is shared meaning. Two conforming
implementations in the same domain can still fail to understand each other —
the testbed found four different definitions of "CO₂ level" on a single valid
server. Closing that gap requires a national profile that pins down vocabularies
and units, conventions for how domains are modelled, a centralised
interoperability test suite, and best practices for implementation as well as
governance. The implementation practices matter because the most damaging
failures found here were silent ones: a dead sensor that is invisible rather
than stale, and a poll cursor that discarded every real measurement while the
stream still looked healthy. The governance side matters because onboarding
sensor networks took more calendar time than writing code. Of the two versions,
Geonovum regards 2.0 as the better candidate to mandate: it resolves a
significant number of the issues found here, and the step up from 1.1 is small
enough not to burden implementers.
