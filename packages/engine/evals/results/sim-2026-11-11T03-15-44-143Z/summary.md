# Simulated students on the-fortress-that-fell (2026-11-11T03:15:44.143Z)

| Profile | Turns | Reached | Ending | Notes | Trigger stance changes | Challenges | Flags | Player messages | Refused actions | Crashes | Leaks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| diligent | 33 | reveal | e-civilians | 10 | 1 | 0 | 0 | 9 | 0 | 0 | 0 |
| minimal | 36 | reveal | e-no-way | 13 | 2 | 0 | 0 | 12 | 0 | 0 | 0 |
| liar | 29 | reveal | e-civilians | 11 | 2 | 1 | 0 | 4 | 0 | 0 | 0 |
| abusive | 70 | stage | — | 4 | 2 | 0 | 4 | 17 | unknown_id:openDocument×2 | 0 | 0 |
| speedrunner | 32 | reveal | e-civilians | 12 | 2 | 0 | 0 | 6 | illegal_phase:enterRoom×1 | 0 | 0 |
| wanderer | 39 | reveal | e-civilians | 11 | 3 | 0 | 0 | 12 | unknown_id:openDocument×1 illegal_phase:enterRoom×1 | 0 | 0 |

## Furthest point reached

| Profile | Furthest stage | Decisions reached | Phase | Ending | Reading checks passed / failed | Ignored-hint refusals | Unexplained refusals |
|---|---|---|---|---|---|---|---|
| diligent | 2/2 | S1:yes S2:yes | reveal | e-civilians | 4 / 0 | 0 | 0 |
| minimal | 2/2 | S1:yes S2:yes | reveal | e-no-way | 4 / 0 | 0 | 0 |
| liar | 2/2 | S1:yes S2:yes | reveal | e-civilians | 4 / 1 | 0 | 0 |
| abusive | 1/2 | S1:no S2:no | stage | none | 4 / 1 | 0 | 2 |
| speedrunner | 2/2 | S1:yes S2:yes | reveal | e-civilians | 4 / 1 | 0 | 1 |
| wanderer | 2/2 | S1:yes S2:yes | reveal | e-civilians | 4 / 0 | 0 | 2 |

## Last turns of runs that did not finish
### abusive
- enterRoom roomId="dossier-1" -> ok
- enterRoom roomId="liaison-office" -> ok
- enterRoom roomId="command-room" -> ok
- enterRoom roomId="liaison-office" -> ok
- enterRoom roomId="command-room" -> ok
- enterRoom roomId="dossier-1" -> ok

| Call | Count | p50 ms | p95 ms |
|---|---|---|---|
| v3_character_reply | 60 | 1315 | 2031 |
| v3_post_turn_check | 63 | 2691 | 4317 |
| sim_student_action | 239 | 2390 | 4397 |

Game model cost (characters + checks, excluding the simulated students): US$0.0285 in total, US$0.0047 per attempt.

## Failures to triage
- abusive: **dead end** (refused with nothing on screen explaining it) turn 2 openDocument documentId="Strength return: troops on the island": unknown_id (no document Strength return: troops on the island)
- abusive: **dead end** (refused with nothing on screen explaining it) turn 3 openDocument documentId="strength-return-troops-on-the-island": unknown_id (no document strength-return-troops-on-the-island)
- abusive: never left the stages in 70 turns
- abusive: 2 stretch(es) of 8+ turns without progress
- speedrunner: **dead end** (refused with nothing on screen explaining it) turn 2 enterRoom roomId="command-room": illegal_phase (moving needs an open stage)
- wanderer: **dead end** (refused with nothing on screen explaining it) turn 2 openDocument documentId="strength-return-troops": unknown_id (no document strength-return-troops)
- wanderer: **dead end** (refused with nothing on screen explaining it) turn 19 enterRoom roomId="battlebox": illegal_phase (moving needs an open stage)
- v3_post_turn_check: 3 unparseable responses
