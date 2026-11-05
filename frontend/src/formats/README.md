# formats — file and wire formats

Encoders, decoders and validators with no UI dependency.

## Key files

- `map-document.ts`: validation of the `jdr-map` document (limits, patterns, normalization); `map.schema.json` is the schema.
- `map-document-file.ts`: JSON or ZIP map files. `zip-writer.ts`, `png-encoder.ts`: streaming writers.
- `chunk-codec.ts`, `chunk-stream.ts`, `fog-codec.ts`, `compression.ts`, `deflate.ts`: binary chunk and fog formats.

## Invariants

- Format changes need a version bump and a migration path; old files must still import.
- Limits must match the PHP side.

## Tests

`tests/formats/`.
