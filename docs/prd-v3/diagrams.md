# PRD v3: Diagrams

> **Derived view, do not edit.** Generated from [`../PRD-v3.md`](../PRD-v3.md) and
> [`../PRD-v3-rationale.md`](../PRD-v3-rationale.md) as of level 5 (agreed). Mermaid diagrams render on GitHub.

## Session
```mermaid
flowchart TD
    B[Role briefing] --> S[Stage opens:<br/>consequences, prediction revealed,<br/>central question]
    S --> I[Investigate]
    I --> D[Defining moment]
    D --> C[Immediate reaction → prediction → outcome by rule]
    C -->|more stages| S
    C -->|last stage| E[Epilogue: your run's ending]
    E --> V[The Interview]
    V --> R[Reveal]
    R --> T[Teacher's own questions]
```

## Investigating (the moment loop)
```mermaid
flowchart TD
    X[Explore the map] --> Q[Question a character]
    X --> RD[Read a document]
    Q --> CH{Did the reply convey a<br/>discovery whose condition is met?}
    CH -->|yes| N[Note added in the role's voice]
    CH -->|no| X
    RD --> KP{Selected passage overlaps<br/>a key passage?}
    KP -->|yes| N
    KP -->|no| X
    N --> PASS[Insert the note into chat<br/>or show a document to someone]
    PASS --> TR{Matches a written trigger?}
    TR -->|yes| ST[Stance changes → discoveries,<br/>acts or documents unlock]
    TR -->|no| X
    ST --> X
```

## How a reply turns into a note
```mermaid
sequenceDiagram
    participant S as Student
    participant G as Game rules
    participant C as Character (model)
    participant K as Checker (cheap model)
    S->>G: Message
    G->>C: Persona, current stance,<br/>discoveries it may reveal now
    C-->>S: Reply in character
    G->>K: Did this reply convey any revealable discovery?
    K-->>G: Discovery id, or none
    G-->>S: Note added (if any)
```

## Unearned assertions
```mermaid
flowchart LR
    A[Student asserts a fact] --> H{Backed by a note?}
    H -->|yes, inserted from notes| P[Counts as passed on;<br/>triggers may fire]
    H -->|no| Ch[Character questions the basis<br/>and prompts them to find out]
    Ch --> Z[No note, no trigger,<br/>no outcome change]
    Ch --> Cnt{Second challenged claim<br/>to this character?}
    Cnt -->|yes| Dn[Trust trigger:<br/>stance drops by one]
```

## Example stances (the Tunku)
```mermaid
stateDiagram-v2
    [*] --> Guarded
    Guarded --> Wary: shown the PAP speech
    Guarded --> Alarmed: shown the riot report
    Wary --> Alarmed: shown the riot report
    Alarmed --> Confiding: told Lee's private offer (note passed on)
```
Confiding is the hidden top stance and can unlock the secret ending.
Triggers and stance names here are illustrative; the generator writes them for each character.

## Hint escalation
```mermaid
flowchart LR
    W[No progress for the stuck time] --> H1[1. Open question,<br/>as the role's thought]
    H1 -->|still stuck| H2[2. A more specific angle]
    H2 -->|still stuck| H3[3. Story event creates an opportunity]
    H3 --> O[Student still has to ask or read]
```

## Endings across stages
```mermaid
flowchart TD
    S1[Stage 1 defining moment] -->|outcome A| S2a[Stage 2, situation A:<br/>closes ending 3]
    S1 -->|outcome B| S2b[Stage 2, situation B:<br/>closes ending 2]
    S2a --> F[Final defining moment]
    S2b --> F
    F --> H[Historical ending]
    F --> A1[Alternative ending 2]
    F --> A2[Alternative ending 3]
    F -.->|hidden act, unlock conditions met| SE[Secret ending]
```
There is always one stage 2; earlier outcomes change its situation and close endings rather than branching into
separate stages. At least two endings stay reachable at the end.
