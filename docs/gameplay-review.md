# Gameplay connections review — 25 September 2026

Reviewed the path from student briefing through exploration, dialogue, evidence, objectives, decisions, stage changes, and the ending/debrief.

| Connection | Finding and result |
| --- | --- |
| Briefing → exploration | The authored decision prompt was absent from the player state. It now appears in the role/stage briefing and beside the goals, before options unlock. |
| Scrolls → reasoning | Generation now asks for actual facts, relevance to a specific trade-off, and a focused question. Supporting excerpts cover the whole scroll. Both pickup and NPC-sharing paths retain all excerpts instead of only the first. |
| Characters → dilemma | The runtime adapter omitted each character's authored public position and the decision question. Both now reach the character's context without adding other characters' private information. |
| Exploration → objectives | Existing validation checks room and target references, inaccessible empty rooms, objective dependency cycles, and whether every objective feeds the decision. Runtime tests cover spatial access, hearing, evidence collection, and substantive dialogue claims. |
| Objectives → choices | Authored and conversation-generated choices remain gated by objectives. Students can reopen their evidence directly beside available choices. The decision panel opens when choices become available, including on resume. |
| Decision/timer → next stage | Existing tests cover branching, expiration, stale choices, and late replies. The UI now clears old movement, document, conversation-draft, and selection state and shows the new briefing. Collected notes remain available. |
| Ending → reflection | The debrief now resolves conversation-generated option labels instead of calling them a timeout, retains collected evidence for reflection, and assigns evidence counts to the correct stage. It only opens for completed attempts. |

## Verification

- Gameplay API suite: 123 tests passed, including a three-stage privacy audit and a path to an ending.
- Generation suite: 105 tests passed; the subsequently added character-context regression also passed (11 integration tests).
- Orchestration suite: 212 tests passed.
- Debrief projection: 5 tests passed for authored choices, conversation-generated choices, timeout, stage-linked notes, and unfinished-attempt access.
- Browser flow: passed at desktop and mobile sizes, including pending pickups, reopening notes, preserved archived notes, and a timer transition while a scroll is open. The fixture uses the real UI/session with mocked transport and no live model.
- Web TypeScript and targeted ESLint checks passed.
- Database debrief suite could not complete: the local database is behind the checked-in migrations (`stage.spec_id` is missing). No database reset was performed. Database joins and persistence still require verification against an up-to-date local schema.

## Content scope

The scroll-authoring change applies to newly generated adventures. Existing published scroll text remains pinned to its authored version and needs editing/regeneration and publishing to gain the richer content. Automated tests verify mechanics and information flow; they do not establish the educational quality of every live model response or every teacher's source material.
