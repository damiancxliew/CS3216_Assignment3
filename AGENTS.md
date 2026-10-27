# Persisted adventure contracts

Before changing persisted adventure fields, types, defaults, or semantic validation, read [the schema evolution contract](docs/v3-build/schema-upgrades.md).

Every persisted contract change must include a new stable SemVer schema version (`MAJOR.MINOR.PATCH`), a registered upgrade path exposed by both the Upgrade action and teacher chat, a review summary, migration fixtures, and tests. Run `npm run check:schema-evolution`. Preserve released schema snapshots and migration history. Classify validator-only fixes explicitly in the evolution manifest with a reason and regression tests.
