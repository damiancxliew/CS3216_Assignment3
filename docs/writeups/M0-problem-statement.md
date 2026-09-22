# M0 — Problem statement

Source: `docs/specs.md` §2, condensed.

History is usually taught as a settled sequence of facts. A student can learn *what*
happened — the date of the surrender, the terms of the treaty — while never encountering
the thing that makes history hard: the people who made those decisions were working with
incomplete information, competing interests, and no knowledge of how it would end.
Knowing the outcome is not the same as understanding the situation that produced it.

Simulation is the obvious fix, and it is the one teachers cannot reach. Building a
curriculum-specific historical game means level design, writing, programming and
historical research — weeks of work for one lesson. The off-the-shelf alternative,
commercial historical games, covers topics the publisher chose, at a granularity no
syllabus matches, and cannot be pointed at the three pages a teacher is actually
teaching next Tuesday.

So teachers fall back on what scales: a worksheet, a source-analysis exercise, a
role-play read from a script. Each of these asks the student to *describe* a decision
rather than *make* one under the constraints the historical actor faced.

**The problem we are solving:** a teacher has the source material and the pedagogical
intent, but no route from that material to an experience where a student has to act
inside it. The gap is production, not ambition.

**Why now:** an LLM can read a teacher's sources and propose a structured world —
locations, stakeholders with conflicting motives, evidence, objectives, a decision point
— in a minute rather than a month. That capability is what removes the production
barrier.

**Why this is not simply "an LLM tutor with a map":** the failure mode that makes
generated history unusable in a classroom is that the model states things that never
happened in the same confident voice it uses for things that did. A product that a
teacher can put in front of thirty students must therefore be organised around one
distinction — what the record says, with a citation, versus what the simulation assumed
— and it must hold that line in the generated content, in the gameplay, and in the
debrief. That constraint is the product, not a disclaimer bolted on afterwards.
