# Pocket Adventures: play redesign and the reference game

Status: proposal for review. Written after the UI revamp on `feat/pocket-ui-revamp`.
The PRD and `fixtures/golden-1819.json` are stale; they are used here only as a reference.

## 1. Critique, most significant first

### 1.1 The game has no spine (biggest problem)

The question the student is finally asked (the Interview: "Was the treaty fair to the people already living
here?") appears for the first time in the last five minutes. Each stage asks a different, plot-level question
("Will the Temenggong let the Company stay?"). The role card's "mission" is a third goal, the role's private wish
("See a British post founded here"). So the student collects evidence for 30 minutes without knowing what it is
evidence *for*, and the role's mission quietly asks them to root for the British before they judge the outcome.

Fix: one inquiry question, shown on the first screen, carried on the stage pill, and asked again at the end.
Stage questions become sub-questions that feed it. The role's personal stake stays, but it is not called the
mission.

### 1.2 Evidence is switched off at the climax

The core skill is using evidence. During the defining moment the Notes tab is disabled and the student picks
from written acts. Whether earlier evidence mattered is invisible: it only works through stances and
"what the decider knows", which the student never sees connected to the choice.

Fix: the student backs their advice with one or two evidence cards, and the decider reacts to them on screen.
The rules already decide outcomes from what each character knows; the cards just make that visible.

### 1.3 Too much reading before play, and in the wrong form

Before the student can move: role card, then "More about your role" (five bullet lists), then the stage title
card, then a three-to-four-beat stage intro, then a preparation explainer. That is four screens and roughly
200 words of dossier. The demo starts on the map with one spoken line ("Hi! I'm Sam. Welcome to Singapore,
1819!") and one short card.

Fix: open in the world. A person greets you, gives you the task and hands you the first source. Goals, fears and
knowledge surface later as the role's own thoughts at the moment they matter.

### 1.4 The decision is two quizzes back to back

Act (pick A/B/C), then prediction (pick A/B/C about what the decider will do), with "Your guess won't change
what happens". It reads as a test, and the second question undercuts the first: you advised, now guess whether
they listen. The decider's answer, which is the dramatic payoff, is buried in the next stage's intro.

Fix: advice, then evidence, then the decider answers in their own (real, cited) words on the spot, as in the demo
("Then we stay. Our object is not territory but trade."). The prediction moves to consequences over time
("Four years from now, what will this river look like?") and is revealed by the next stage's title card.

### 1.5 The ending is three separate screens and a long page

Epilogue box, then the Interview with a stranger (a clerk from 1824), then a reveal page that scrolls through
what happened, path vs history, corrections, missed ideas and "show more". The verdicts are opinions with no
link to anything the student did, and the reveal's "Matched history" badges are the only payoff.

Fix: a single debrief that closes the loop opened on the first screen (your journey, the big question, your
answer with evidence), a push-back from someone the student actually met, then a short reveal in cards with one
twist: the question itself contained a myth.

### 1.6 The decision is hidden in a side panel

"I'm ready to decide" / "Review stage decision (3 steps left)" is a small button in the Mission panel. The most
important action of the stage reads like a form submit.

Fix: when the student is ready, the decider gets a gold star on the map and a bottom prompt appears ("Raffles is
ready to hear your advice"). Walking up to them starts the scene.

### 1.7 Four surfaces compete for attention

Mission panel (question, latest log, location, timer, checklist, decide button), Journal (three tabs, 40rem),
story toasts (top centre), note and source toasts (right), the talk prompt (bottom) and the dialogue (bottom).
The "latest log" appears in both the Mission panel and the Journal. On a phone the Mission panel covers a third of
the map.

Fix: the stage pill expands into a compact goal card (sub-question and up to three leads). All events go to one
toast stack on the right. The Journal becomes a card tray (see 1.8). Location and timer move into the pill.

### 1.8 Notes are a list, not a tool

Notes are the game's currency: shown to people, used at the decision and in the debrief. They live in a text
list behind a tab, and in conversation behind "Insert a note".

Fix: notes become evidence cards with a source icon (person or document) and a short title. A card tray sits
bottom right with a count; in conversation the tray is "Show evidence". The same cards are played at the decision
and the debrief.

### 1.9 The blank text box

Free-text questions to a character are the heart of the game, but a 13-year-old facing "Ask Raffles a question"
often types "hi". Fix: two or three question starters under the input, drawn from the character's open questions
("Why here and not Riau?"). They fill the box; the student can edit or send. These are starters, not hints, so
they don't conflict with hints arriving only automatically.

### 1.10 Smaller issues

- Mood pills show stance names ("WARY"). The PRD says stance names are never shown (P6.5), but the demo
  relies on them ("DOUBTFUL" → "CURIOUS"), and they are the clearest feedback in the game. Recommend keeping
  them, written as moods, and updating the rule.
- Minor characters' name tags crowd the map ("Neighbour", "Goat herder", "Weaver"). Name only people with
  something to say, or people near you.
- Reading checks (multiple choice plus highlight a supporting passage) are good practice but feel like a
  worksheet when they gate every source. Gate one source per stage, the one the decision depends on.
- The interviewer shows initials and no face. The debrief needs a portrait, like everyone else.

## 2. The reference game: "From village to port" (Singapore, 1819–1823)

This is the game in the demo video, filled out. It replaces the mock and `golden-1819` as the example used by the
engine mock, the showcase harness, generation few-shots and tests.

Historical claims below are what I believe to be accurate; each must be checked against the cited sources
before the fixture is final. Items marked *verify* need checking.

- Level: Lower Secondary (Sec 1). Length: 45 minutes. Two stages.
- You play **Sam**, clerk to Stamford Raffles. A clerk writes everything down, so carrying notes and letters fits
  the role. Fictional.
- **The big question:** "How did a small fishing village become a great port?"
  The question is deliberately loaded. The debrief's push-back and the reveal ask whether it was ever "a small
  fishing village": Temasek in the 14th century, Malay and Orang Laut communities, about a thousand people in 1819
  (*verify* figure), Chinese gambier planters. This mirrors the bicentennial question of whether Singapore's
  history is 200 or 700 years long.
- **Answer format:** which factor mattered most. Verdicts: location on the trade routes; free trade; the people
  who came to trade and settle; agreements with Malay rulers. All are defensible; the push-back cuts against
  whichever is picked.

### 2.1 Opening (about 2 minutes)

1. Logo over the live map at the jetty, five seconds.
2. Sam's first line in the dialogue box: "Hi! I'm Sam. Welcome to Singapore, 1819!"
3. Role card, one screen: "You play Sam · Clerk to Stamford Raffles · Singapore River, January 1819". Your task:
   "Help Raffles decide whether to build a port here." The big question above, the stage track (1819, 1823) below.
   One button: "Let's go". The details move into the role brief, reopened from the HUD.
4. On the map, Raffles has a "!". Talking to him is the real briefing: three lines, then he hands you his notes
   (the first source). No stage intro cinematic for stage 1.

### 2.2 Stage 1: "Why here?" (Singapore River, late January 1819, about 13 minutes)

Sub-question: "Why did Raffles want a port at Singapore?"

| Person | Role in play | Starts as | What they can give |
|---|---|---|---|
| Stamford Raffles (real) | Decider | Hopeful | His reasons; the Dutch threat |
| Ship's captain (fictional country trader) | The doubter | Doubtful | "No ship will stop here"; moves to Curious when shown evidence of trade |
| Temenggong Abdul Rahman (real) | Authority | Guarded | Who governs here; his people; his terms |
| A Bugis trader (fictional) | Witness | Friendly | Monsoon winds; Riau's duties drive traders away |
| An Orang Laut boatman (fictional) | Witness, minor | Shy | "We have always been here"; the old name Temasek |

Sources: Raffles's letter on the advantages of Singapore (real, *verify* recipient and date; the demo uses the
letter to Colonel Addenbrooke, 10 June 1819, printed 1878). A Dutch protest or report on Riau (real or
reconstructed, slanted: "the island is empty and of no value"). A sketch map of the straits (image).

Core discoveries: on the trade routes between India and China; a sheltered harbour; Riau's duties drive traders
away, so a free port would draw them; the Temenggong governs the island and must agree; people already live here.

The doubter beat: the captain says "This swampy island? No ship will ever bother to stop here." Showing him a note
about the trade routes or the shipping (from Raffles's letter or the Bugis trader) moves him to Curious, and he
adds a discovery of his own. Showing the boatman's note moves him again: "So there were people here all along."

Defining moment, at Raffles's tent. Raffles: "You have heard them all. Do we stay?"

- A: "Yes. It sits at the heart of the trade routes, and ships come from all quarters." (historical)
- B: "No. The captain says no ship will stop here."
- C: "Not yet. Let's keep looking."
- Informed act, shown only if you hold the Temenggong's terms: "Yes, but only with the Temenggong's
  agreement."

Then "Back it up": play up to two evidence cards. Raffles reacts to each one in a line. Then he answers. On the
historical path he answers in his own words, with a caption: "His own words, from his letter of … 1819".

Prediction (consequence, not decision): "Four years from now, what will this river look like?"
Three options (a busy port; a struggling outpost; a Dutch harbour). Revealed on the stage 2 title card.

### 2.3 Stage 2: "A port that grew" (Singapore, 1823, about 13 minutes)

Title card: "STAGE 2 OF 2 · A port that grew", with your prediction and what happened. The captain from stage 1
is back as a regular trader, which pays off the doubter beat.

Sub-question: "What made traders come, and stay?"

| Person | Role in play | Starts as | What they can give |
|---|---|---|---|
| Stamford Raffles (real) | Decider | Determined | Free port; the town plan; banning gambling and the slave trade (*verify* dates) |
| William Farquhar (real) | The doubter | Defensive | Revenue farms (opium, gambling) pay for the settlement; he let it grow his way |
| A Hokkien merchant (fictional) | Witness | Busy | Why Chinese junks come; no duties |
| The captain (returning) | Ally | Curious → Convinced | Trade numbers; ships at anchor |
| A Malay noble from Sultan Hussein's household (fictional) | Authority | Wary | The Sultan's allowance; who really owns the land |

Sources: a trade figures table or a population count (real, *verify* the 1824 census figure); Raffles's
regulations, 1823 (real excerpt, *verify*); a merchant's letter (reconstructed); the town plan (image).

Defining moment. Raffles: "The settlement needs money. Do we tax the trade?"

- A: "No. Keep it a free port; that is why they come." (historical)
- B: "Yes. Put a small duty on every ship."
- C: "Let Farquhar's revenue farms pay for it."
- Informed act, if you hold the merchant's and the noble's notes: "Keep it free, and settle the land question with
  the Sultan." This leads towards the 1824 treaty in the reveal.

Prediction: "What will happen to the island itself?" (it becomes British; the Sultan keeps it; the Dutch claim it).
Revealed in the epilogue.

### 2.4 Ending (about 12 minutes)

1. **Epilogue** (one screen, on the map): Sam at the jetty in 1823, the harbour full. Your prediction revealed.
   Labelled as your simulation.
2. **Debrief** (the demo's panel):
   - Your journey: pills computed from play ("Five notes collected", "Captain convinced", "Trusted by Raffles",
     "One secret found").
   - The big question, the same words as the first screen.
   - Pick the factor that mattered most (A–D), write one sentence, attach up to three evidence cards. Submit.
3. **Push-back from someone you met.** The Temenggong (or the boatman, if you met him) answers your verdict with
   the evidence that cuts against it, and always asks the trap question: "You call it a small fishing village.
   My people traded here long before your ships." Respond: keep or change your answer, and add one line.
4. **Reveal**, four cards, one at a time:
   1. What really happened, 1819–1824: a timeline with images (treaty of 6 February 1819; free port; 1823
      regulations; 1824 treaties). *verify* each date.
   2. Your path and history, side by side, per stage. Your predictions and how they turned out.
   3. "The question had a trap": Temasek, the people already there, and the bicentennial debate (200 or 700 years).
      Corrections for anything slanted you believed (the "empty island" report).
   4. What historians argue (Raffles as founder; Farquhar's role; Malay rulers' choices; the trade network that
      was already there), your answer next to them, and your teacher's questions.

Timing: opening 2, stages 26, epilogue 1, debrief 6, reveal 6. About 41 minutes, which leaves slack.

## 3. Layout target

- **Top left:** the stage pill. Tap it to expand the goal card: sub-question, up to three leads ("Talk to the
  captain", "Read Raffles's letter"), timer.
- **Top right:** HUD with at most three buttons (role brief, sound, menu). Toasts stack below it.
- **Bottom right:** the evidence card tray with a count badge. It replaces the Journal button; the full Journal
  (cards, sources, log) opens from it as a bottom sheet on phones.
- **Bottom centre:** context prompt ("E: Talk to the captain"; "Raffles is ready to hear your advice").
- **Dialogue box:** portrait with the mood expression, name, mood pill, one line at a time (history on scroll), the
  input with two or three question starters, and "Show evidence".
- **Decision:** DECISION ribbon; advice (A–D); "Back it up" with cards; the decider's answer, full width with a
  real portrait when the figure is real.
- **Phones:** the map at full height; the goal card collapses to the pill; the tray and the dialogue are bottom
  sheets.

## 4. What changes outside the UI

### 4.1 Persisted spec (needs a new schema version, upgrade step, fixtures and tests per AGENTS.md)

- An adventure-level `question` and its `verdicts` (factors), replacing one Interview question per ending. Endings
  keep their epilogue; each ending may tune the push-back.
- `role.greeting` (Sam's first line) and `role.task` (one line). `privateBrief` stays, surfaced as thoughts.
- `opening`: which character briefs you, their lines, and the document they hand over. Replaces the stage 1 intro
  beats.
- Per stage `subQuestion`, and an optional `doubter` character id (used for leads and journey pills).
- Acts: optional `informedBy` discovery ids (the act appears only when known; it may carry a "from your notes" mark).
- The decider's historical reply: `reply` text plus a citation, shown as their own words.
- Predictions phrased as consequences, with where each is revealed.
- The push-back speaker is a character from the adventure, not a separate interviewer.
- A scanned page per document (the earlier phase 6).

### 4.2 Play contract and engine (no schema version)

- `act` takes `evidenceNoteIds` (up to two). The engine passes them to the decider before resolving, through the
  same path as showing a note. The outcome rules are unchanged.
- The view adds `journey` (computed pills), `question` from the first screen to the last, `leads`, and a `ready`
  signal on the decider.
- The stance view adds the ladder size, so mood colours are exact.

### 4.3 Generation

- Backward design: the skeleton pass writes the big question and its verdicts first, then the discoveries that
  bear on each verdict, then the stages that lead to them. A check confirms every verdict has evidence for and
  against in the playable content.
- Write one doubter per stage with a note-passed trigger, and one informed act per moment.
- Write the decider's historical reply from a cited quotation when one exists.

### 4.4 Harness

- Rewrite the engine mock script as "From village to port", and add `fixtures/village-to-port.json` as the new
  golden fixture. Keep `golden-1819` until its tests move.
- Commit the showcase harness (`/showcase/play`, local only) with the screenshot script, so each change can be
  checked at desktop and phone widths.

## 5. Decisions needed

1. Is the "small fishing village" premise a deliberate trap that the push-back and reveal correct? (Recommended.)
2. Show mood names (overturning P6.5)? (Recommended: yes, written as moods.)
3. Two stages, or three with 1824 "Whose island?" as an extension?
4. Should informed acts carry a "from your notes" mark? It tells the student their evidence opened the option
   without saying which act is historical.
5. Push-back from a character the student met, instead of an interviewer from later? (Recommended.)
