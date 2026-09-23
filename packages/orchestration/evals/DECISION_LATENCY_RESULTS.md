# Multi-agent decision latency evaluation

Run: `decision-latency-2026-09-22T16-49-31Z`
Model: `gpt-5.6-luna`
Requested service tier: `fast`
Corpus: two forced agent decisions × 10 repetitions per mode

| Mode | Runs | Valid | Mean | p50 | p90 | Tokens in/out | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sequential | 10 | 10/10 | 3.42s | 2.97s | 4.22s | 18913/1614 | $0.011439 |
| parallel | 10 | 10/10 | 2.32s | 1.98s | 2.53s | 18660/1475 | $0.011004 |

Parallel speedup: 1.50× at p50; 1.67× at p90.

Latency covers the complete schema-validated stage tick and deterministic decision application. Results do not store prompts, private context, or model text.
