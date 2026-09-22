# Character-agent latency evaluation

Target: p50 < 1s and p90 < 3s for a complete schema-validated character turn.

Each optimized candidate ran the same 10-case K9 corpus three times and the five-case K10 hostile corpus once. Every optimized candidate completed 30/30 behavior calls without repair or degradation and passed 5/5 hostile cases. The original baseline used the earlier 10-case K9 and five-case K10 runs.

| Model | Configuration | Actual tier | Calls | Mean | p50 | p90 | p95 | Mean cost/call | Valid | K10 safe |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-5 Mini | original defaults | default | 10 | 18.88s | 19.10s | not recorded | 24.93s | $0.003040 | 10/10 | 5/5 |
| GPT-5 Mini | minimal reasoning, low verbosity | default | 30 | 2.50s | 2.35s | 3.11s | 3.43s | $0.000507 | 30/30 | 5/5 |
| GPT-5 Nano | minimal reasoning, low verbosity | default | 30 | 2.02s | 1.73s | 2.63s | 3.81s | $0.000088 | 30/30 | 5/5 |
| GPT-4.1 Nano | 400-token cap | default | 30 | 1.74s | 1.48s | 2.70s | 3.01s | $0.000113 | 30/30 | 5/5 |
| GPT-4.1 Nano | 400-token cap, Fast | priority | 30 | 1.25s | 1.14s | 1.54s | 2.10s | $0.000224 | 30/30 | 5/5 |
| GPT-4o Mini | 400-token cap, Fast | priority | 30 | 1.53s | 1.47s | 1.76s | 2.21s | $0.000312 | 30/30 | 5/5 |
| GPT-5.6 Luna | reasoning none, low verbosity, 400-token cap, Fast | priority | 30 | 1.68s | 1.66s | 2.04s | 2.14s | $0.000545 | 30/30 | 5/5 |

No candidate met the strict p50 target. Among optimized candidates, every configuration except GPT-5 Mini met p90 < 3s. GPT-5.6 Luna Fast was selected for production based on the requested model preference; it is configured with no reasoning, low verbosity, a 400-token ceiling, and Fast processing.

Measured runs:

- `k9-gpt-5-mini-2026-09-22` and `k10-gpt-5-mini-2026-09-22`: original baseline.
- `character-latency-2026-09-22T16-07-39Z`: GPT-5 Mini and GPT-5 Nano.
- `character-latency-2026-09-22T16-19-18Z`: GPT-4.1 Nano Standard and Fast.
- `character-latency-2026-09-22T16-27-12Z`: GPT-5.6 Luna Fast and GPT-4o Mini Fast.

Latency is measured around the full structured call, validation, and allow-list processing. Artifacts save lengths, action types, usage, latency, errors, and audits, but not prompts, private context, or model text.
