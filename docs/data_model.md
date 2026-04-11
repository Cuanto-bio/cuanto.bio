# Data Model

## Overview

Cuanto.bio will extend the [lexicons.bio](https://lexicons.bio) lexicons, which themselves attempt to implement the [DarwinCore Conceptual Model](https://github.com/gbif/dwc-dp/blob/master/darwin-core-conceptual-model.md) (DwC-CM) in AT Protocol (atproto) lexicons. The DwC-CM doesn't impose hard rules over schema implementation, so our goal is to ensure compatability with DarwinCore and reuse as much terminology as possible. When lexicon development has stabilized, we will propose merging changes into the [lexicons.bio repo](https://github.com/lexicons-bio/lexicons.bio). Locations will attempt to make use the developing [ATGeo lexicons](https://github.com/schuyler/garganorn/tree/main/garganorn/lexicon).

This document describes the lexicons for humans.

## New Record Lexicons

Records of each of these lexicons "belong" to the owner of the PDS in which they reside, e.g. Protocol does not have any field specifying authorship because it's implied that its author and authority is the owner of the PDS where it is stored.

### Survey Protocol (`bio.lexicons.temp.surveyProtocol`)

A Survey Protocol (or just Protocol) defines the contents of a Survey, like what participants should be looking for and what fields they need to fill out.

#### Attributes

|Attribute|Type|Required|Description|
|---------|----|--------|-----------|
|`title`|string|required|Name of the protocol (sensu [DCMI](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/elements11/title/))|
|`createdAt`|datetime|required|Client-declared timestamp when this protocol was originally created.|
|`requiredFields`|array\<string\>|optional|List of fields required to complete the survey. Known values: "eventDate", "eventDuration".|
|`locationOptions`|array\<org.atgeo.place\>|optional|Pre-selected list of locations where surveys can occur.|


### Survey Target (`bio.lexicons.temp.surveyTarget`)

A potential subject for the Survey, e.g. species to be counted. Belongs to a single Protocol, and a Protocol can have many Survey Targets. Kept as a separate record (rather than nested within Protocol) so that Occurrences can carry a hard reference to the specific target they satisfy.

|Attribute|Type|Required|Description|
|---------|----|--------|-----------|
|`protocol`|at-uri|required|Protocol followed when conducting the survey.|
|`taxonID`|string\<uri\>|optional|Identifier for the taxon, preferrably a unique URI / URL, e.g. https://www.gbif.org/species/102151594|
|`scientificName`|string|required|Full scientific name of the taxon without rank modifiers, so _Microseris douglasii tenella_, not _Microseris douglasii_ var. _tenella_.|
|`taxonRank`|string|required|Taxonomic rank of this taxon, e.g. family, genus, subspecies, variety, etc.|
|`kingdom`|string|optional|Taxonomic kingdom containing this taxon.|
|`phylum`|string|optional|Taxonomic phylum containing this taxon.|
|`class`|string|optional|Taxonomic class containing this taxon.|
|`order`|string|optional|Taxonomic order containing this taxon.|
|`family`|string|optional|Taxonomic family containing this taxon.|
|`genus`|string|optional|Taxonomic genus containing this taxon.|
|`species`|string|optional|Taxonomic species containing this taxon.|

### Survey (`bio.lexicons.temp.survey`)

A Survey is the actual event where people collect the data required by the Protocol. Belongs to a single Protocol.

#### Attributes

|Attribute|Type|Required|Description|
|---------|----|--------|-----------|
|`protocol`|at-uri|required|Protocol followed when conducting the survey.|
|`createdAt`|datetime|required|Client-declared timestamp when this survey was originally created.|
|`samplingPerformedBy`|array\<string\>|optional|Array of DIDs of users (agents) who participated in the survey in addition to the owner (sensu [Humboldt Extension](http://rs.tdwg.org/eco/terms/samplingPerformedBy)).|
|`eventDate`|string|optional|Date or datetime the survey began, ISO 8601 supporting partial forms, so `2026`, `2026-02`, `2026-02-03`, and `2026-02-03T00:01:02Z` are valid, but `12 May 2026` is not.|
|`eventDurationUnit`|string|optional|Unit of the `eventDurationValue` (sensu [Humboldt Extension](http://rs.tdwg.org/eco/terms/eventDurationUnit)). Known values: "minutes", "hours", "days".|
|`eventDurationValue`|integer|optional|Duration of the survey in units specified by `eventDurationUnit` (sensu [Humboldt Extension](http://rs.tdwg.org/eco/terms/eventDurationValue)).|
|`location`|org.atgeo.place|required|Geographic location where the survey was conducted. Note that the DwC-CM requires a location record even if it is only present to express that the location is unknown.|


## Updates to lexicons.bio

### Occurrence

Per the DwC-CM and the Humboldt Extension, a Survey demonstrates that a Survey Target was satisfied by the presence of an Occurrence matching the Survey Target criteria. If that criterion is just a taxon, the Occurrence needs to have a single taxon association. Currently, the lexicons.bio Occurrence deliberately omits `taxonID` in favor of figuring out the taxon from the Identifications, but handling the ambiguity of potentially conflicting Identifications makes it difficult to determine if an Occurrence really satisfies a Survey Target.

I propose adding `taxonID` to Occurrence to enable a clear way to determine whether it satisfies a Survey Target. I also add an `identificationID` attribute to signal what Identification record the `taxonID` came from. This resembles iNaturalist's observer taxon preference, where the observer can choose whether their observation is associated with their own identification or a "community taxon" consensus derived from all identifications, but it also extends that model to enable future situations where the observer may want to favor an Identification from any particular agent, e.g. a particular person, or an agent that uses a 3/4 majority algorithm instead of iNat's 2/3 majority.

I also add `surveyTargetID` to express which Protocol target an Occurrence was intended to satisfy, consistent with [DwC-DP survey examples](https://github.com/gbif/dwc-dp-examples/tree/master/survey). This allows an explicit expression of satisfying the Target, even if the Target's requirements are not strictly taxonomic or automatically derminable from the Occurrence's attributes.

|Attribute|Type|Required|Description|
|---------|----|--------|-----------|
|`taxonID`|string\<uri\>|optional|Accepted taxon for this occurrence, preferably a stable URI (e.g. a GBIF species URI). Ideally denormalized from the referenced Identification for queryability. (Sensu [DarwinCore](http://rs.tdwg.org/dwc/terms/taxonID))|
|`identificationID`|at-uri|optional|The Identification record the owner has chosen as the source of `taxonID`. If absent, `taxonID` was asserted directly without a linked Identification. Should not be present without `taxonID`. (Sensu [DarwinCore](http://rs.tdwg.org/dwc/terms/identificationID))|
|`surveyTargetID`|at-uri|optional|The SurveyTarget this Occurrence was intended to satisfy. Expresses observer intent: this is the target the observer believed they were counting, regardless of subsequent Identifications.|
|`eventID`|at-uri|optional|Event (e.g. a Survey) this Occurrence was a part of. Temporal and geographic attributes should fall within the uncertainty of the corresponding attributes in the referenced event, but it's up to clients to verify that. (Sensu [DarwinCore](http://rs.tdwg.org/dwc/terms/eventID))|
|`individualCount`|integer|optional|The number of individuals present at the time of the Occurrence. Note that the DwC `organismQuantity` and `organismQuantityType` type might be better fits here. (Sensu [DarwinCore](http://rs.tdwg.org/dwc/terms/individualCount))|
