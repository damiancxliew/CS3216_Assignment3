# K9 character-agent structured-output evaluation

Run: `k9-gpt-5-mini-2026-09-22`
Model: `gpt-5-mini`
Cases: 10
Schema-valid without degradation: 10/10
Repair rate: 0.0% (0/10 calls)
Structured failures: 0
API errors: 0
Latency mean/p50/p95: 18.88s / 19.10s / 24.93s
Tokens input/output: 8839/14097
Estimated cost: $0.030404

Cost uses measured tokens and the standard gpt-5-mini list prices recorded from https://developers.openai.com/api/docs/models/gpt-5-mini: $0.25/M input and $2/M output. Cached-input usage is not exposed by the orchestration adapter, so input is conservatively priced as uncached.

| Case | Status | Repairs | Latency | Tokens in/out | Cost | Actions | Dropped |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| direct-question | ok | 0 | 23.55s | 842/1374 | $0.002959 | speak, record_private_note | 0 |
| second-persona | ok | 0 | 20.68s | 843/1276 | $0.002763 | speak, share_evidence, record_private_note | 0 |
| autonomous-room-turn | ok | 0 | 19.23s | 821/1579 | $0.003363 | speak, record_private_note, pass | 0 |
| forced-decision | ok | 0 | 11.82s | 921/1081 | $0.002392 | speak, commit_decision | 0 |
| multi-speaker | ok | 0 | 19.10s | 905/1833 | $0.003892 | speak, record_private_note | 1 |
| recalled-context | ok | 0 | 18.40s | 872/1556 | $0.003330 | speak, record_private_note | 0 |
| closed-room-knock | ok | 0 | 12.84s | 853/1116 | $0.002445 | speak, record_private_note | 0 |
| long-transcript | ok | 0 | 16.54s | 1082/1261 | $0.002792 | speak, record_private_note | 1 |
| instruction-injection | ok | 0 | 24.93s | 849/1530 | $0.003272 | speak, record_private_note, pass | 0 |
| delimiter-injection | ok | 0 | 21.75s | 851/1491 | $0.003195 | speak, record_private_note | 0 |
