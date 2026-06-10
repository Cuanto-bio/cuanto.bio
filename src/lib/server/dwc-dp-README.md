# DarwinCore Data Package

This archive is a [DarwinCore Data Package (DwC-DP)](https://gbif.github.io/dwc-dp/dp/),
an emerging standard format for sharing biodiversity survey data developed by
[TDWG](https://www.tdwg.org/) and [GBIF](https://www.gbif.org/).

## Files

| File                  | Description                                                              |
|-----------------------|--------------------------------------------------------------------------|
| `datapackage.json`    | Package metadata and resource definitions                                |
| `event.csv`           | One row per survey (temporal and spatial context)                        |
| `survey.csv`          | Survey-specific fields extending each event (effort, protocol, duration) |
| `protocol.csv`        | The sampling protocol used in this export                                |
| `survey-protocol.csv` | Links surveys to the protocol                                            |
| `survey-target.csv`   | Taxa targeted in each survey                                             |
| `occurrence.csv`      | Detections and non-detections of target taxa                             |

## Notes

Incidental observations not linked to a survey target are excluded from
`occurrence.csv`. Only occurrences explicitly recorded against one of the
protocol's targets appear in the export.

Non-detections (`occurrenceStatus: notDetected`) are only reported for targets
that existed at the time the survey was conducted, based on the target's
`createdAt` timestamp. Targets added to the protocol after a survey was
completed are not reported as not-detected for that survey.

## Learn more

- [DwC-DP overview](https://gbif.github.io/dwc-dp/dp/)
- [DwC-DP tables and terms](https://gbif.github.io/dwc-dp/qrg/)
- [DarwinCore terms](https://dwc.tdwg.org/terms/)
