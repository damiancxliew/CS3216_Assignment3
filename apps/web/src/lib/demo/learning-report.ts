import { sources, stages } from "./lim-bo-seng";
import { projectDemoV3, type DemoV3State } from "./v3-session";

/** Offline, printable report. Never interpolate student or model text as markup. */
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
const paragraph = (text: string) => `<p class="written">${escape(text)}</p>`;
const empty = (text: string) => `<p class="empty">${escape(text)}</p>`;
const sourceId = (noteId: string) => noteId.replace(/^source-\d+-/, "");
const cast = new Map(
  stages.flatMap((stage) =>
    stage.npcs.map((npc) => [npc.id, npc.name] as const),
  ),
);
const sourceLink = (id: string) => {
  const source = sources.find((s) => s.id === id);
  return source
    ? `<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)}</a>`
    : escape(id);
};
function notesHtml(notes: DemoV3State["notes"]) {
  return notes.length
    ? notes
        .map(
          (note) =>
            `<article class="note">${paragraph(note.text)}<p class="caption">${note.source === "document" ? sourceLink(sourceId(note.id)) : "Conversation note"}</p></article>`,
        )
        .join("")
    : empty("No evidence passages saved yet.");
}
function transcript(messages: DemoV3State["messages"]) {
  return messages.length
    ? messages
        .map((message) => {
          const person = message.characterId
            ? cast.get(message.characterId)
            : null;
          const speaker =
            message.kind === "player"
              ? `Student${person ? ` → ${person}` : ""}`
              : message.kind === "character"
                ? (person ?? "Earlier character")
                : "Scene narration";
          return `<article class="message ${message.kind === "player" ? "student" : ""}"><h4>${escape(speaker)}</h4>${paragraph(message.text)}</article>`;
        })
        .join("")
    : empty("No conversations recorded yet.");
}

export function learningReportHtml(
  state: DemoV3State,
  createdAt = new Date(),
): string {
  const interview = projectDemoV3({ ...state, phase: "interview" }).interview!;
  const date = new Intl.DateTimeFormat("en-SG", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(createdAt);
  const references = new Set([
    ...state.notes
      .filter((n) => n.source === "document")
      .map((n) => sourceId(n.id)),
    ...state.decisions.flatMap((d) => d.evidence),
  ]);
  const chapters = stages
    .map((stage, index) => {
      const decision = state.decisions.find((d) => d.stage === index);
      const choice = stage.choices.find((c) => c.id === decision?.choice);
      return `<section class="chapter"><p class="eyebrow">Chapter ${index + 1} · ${escape(stage.date)}</p><h2>${escape(stage.title)}</h2>
      <p class="question">${escape(stage.question)}</p>
      ${
        choice
          ? `<div class="decision"><p class="eyebrow">My recommendation</p><h3>${escape(choice.title)}</h3>${paragraph(choice.detail)}<p><strong>Trade-off:</strong> ${escape(choice.cost)}</p><p><strong>Illustrated consequence:</strong> ${escape(choice.outcome)}</p></div>
      <p class="caption"><strong>Evidence attached to this decision:</strong> ${decision!.evidence.length ? decision!.evidence.map(sourceLink).join(" · ") : "None recorded"}</p>`
          : empty("No recommendation recorded for this chapter yet.")
      }
      <h3>My evidence notes</h3>${notesHtml(state.notes.filter((n) => n.stageIndex === index))}
      <aside><strong>Historical boundary</strong>${paragraph(stage.historian)}</aside></section>`;
    })
    .join("");
  const reflections = [interview.question, interview.pushBack]
    .map((question, index) => {
      const answer = state.answers[index];
      const verdict = interview.verdicts.find(
        (v) => v.id === answer?.verdictId,
      );
      return `<article class="reflection"><h3>${index === 0 ? "My explanation" : "Testing my explanation"}</h3>${question ? paragraph(question) : ""}
      ${
        answer
          ? `<p><strong>Selected claim:</strong> ${escape(verdict?.text ?? answer.verdictId)}</p>${answer.text?.trim() ? paragraph(answer.text) : empty("No written explanation entered.")}
      <h4>Evidence I cited</h4>${answer.evidenceNoteIds.length ? notesHtml(state.notes.filter((n) => answer.evidenceNoteIds.includes(n.id))) : empty("No evidence notes cited.")}`
          : empty("Not answered yet.")
      }</article>`;
    })
    .join("");
  const legacy = state.previousFiveStageProgress;
  const oldNames = [
    "Departure",
    "Training",
    "Landing",
    "Civilian survival",
    "Network under pressure",
  ];
  const oldChoices: Record<string, string> = {
    family: "Support the household",
    contacts: "Connect people",
    depart: "Prioritise departure",
    rehearse: "Practise listening and coordination",
    listen: "Make room for private concerns",
    schedule: "Keep the departure schedule",
    consent: "Ask what help is possible",
    supplies: "Share supplies before asking",
    wait: "Allow time to understand",
    household: "Keep two shares with households",
    pool: "Pool provisions and negotiate",
    team: "Keep two shares for assistance",
    corroborate: "Seek a second perspective",
    limit: "Narrow the recommendation",
    record: "Record uncertainty and proceed",
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Cost of Resistance — Learning report</title>
<style>
:root{color-scheme:light;--ink:#243d34;--muted:#58645b;--line:#d9dfd3;--paper:#fffdf7;--gold:#b08a43}
*{box-sizing:border-box}body{margin:0;background:#e9ede5;color:var(--ink);font:15px/1.65 system-ui,-apple-system,sans-serif}main{max-width:900px;margin:32px auto;background:var(--paper);padding:56px 64px;box-shadow:0 10px 40px #23382c15}h1,h2{font-family:Georgia,serif;line-height:1.2}h1{font-size:44px;margin:12px 0}h2{font-size:29px;margin:8px 0 20px}h3{font-size:17px;margin:20px 0 8px}h4{font-size:13px;margin:0 0 5px}p{margin:8px 0 14px}.eyebrow{font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase;color:#756039}.subtitle{font-size:20px}.meta,.caption,.empty{font-size:13px;color:var(--muted)}.empty{font-style:italic}.toolbar{max-width:900px;margin:20px auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 12px}.toolbar p{margin:0;font-size:13px}button{border:0;border-radius:5px;background:#285c4d;color:white;padding:12px 20px;font:600 14px system-ui;cursor:pointer;white-space:nowrap}button:focus-visible,a:focus-visible{outline:3px solid #b08a43;outline-offset:3px}header{border-bottom:3px solid var(--gold);padding-bottom:28px}.stats{display:flex;gap:24px;flex-wrap:wrap;margin-top:24px}.stats span{font-size:13px}.stats strong{display:block;font-size:24px}.chapter,.reflections,.references,.appendix{margin-top:40px;padding-top:12px}.chapter+.chapter{border-top:1px solid var(--line);padding-top:32px}.question{font-size:18px;color:#48614e}.decision{background:#edf2e8;border-left:4px solid #426751;padding:16px 22px}.decision h3{margin-top:3px}.note{border-left:2px solid #c1b18d;padding:3px 0 3px 18px;margin:16px 0}.written{white-space:pre-wrap;overflow-wrap:anywhere}aside{background:#f4f0e5;padding:16px;font-size:13px;margin-top:24px}.reflection{border-top:1px solid var(--line);padding-top:12px}.reference{margin:18px 0;font-size:13px}a{color:#285c4d;text-decoration:underline;overflow-wrap:anywhere}.message{border-bottom:1px solid var(--line);padding:12px 16px;font-size:13px}.message.student{background:#edf2e8}.message p:last-child{margin-bottom:0}footer{margin-top:40px;border-top:2px solid var(--gold);padding-top:16px;font-size:12px;color:var(--muted)}
@media(max-width:600px){main{margin:0;padding:28px 22px}h1{font-size:34px}h2{font-size:25px}.toolbar{flex-wrap:wrap}.stats{gap:20px}}
@page{size:A4;margin:17mm 16mm}
@media print{body{background:white;font-size:10.5pt;line-height:1.5}.toolbar{display:none}main{margin:0;padding:0;max-width:none;box-shadow:none;background:white}h1{font-size:30pt}h2{font-size:21pt}h3{font-size:13pt}h1,h2,h3,h4,.eyebrow{break-after:avoid}p{orphans:3;widows:3}.chapter,.reflections,.references,.appendix{break-before:page;margin-top:0}.decision,aside{break-inside:avoid}.message,.note{break-inside:auto}a{color:inherit}.caption,.meta,.empty{font-size:9pt}.stats strong{font-size:20pt}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="toolbar"><p>Your report is saved in this file. Print it or choose “Save as PDF” in the print dialog.</p><button type="button" id="print-report">Print / Save as PDF</button></div>
<main><header><p class="eyebrow">Sec 2 History · Chapter 6 · Japanese Occupation</p><h1>The Cost of Resistance</h1><p class="subtitle">My learning report</p><p class="meta">Exported ${escape(date)} (Singapore time) · ${state.phase === "reveal" ? "Lesson completed" : "Progress so far"}</p><div class="stats"><span><strong>${state.decisions.length} / ${stages.length}</strong>Decisions recorded</span><span><strong>${state.notes.length}</strong>Evidence notes</span><span><strong>${state.answers.length} / 2</strong>Reflections recorded</span></div></header>
<p>This report records your recommendations, saved evidence and reflections as a student observer. Recommendations and reconstructed conversations are learning activities, not records of the historical figures’ choices. No automated grade is assigned.</p>
${chapters}<section class="reflections"><p class="eyebrow">Making sense of the experience</p><h2>My final reflections</h2>${reflections}</section>
<section class="references"><p class="eyebrow">Evidence and provenance</p><h2>Sources in my record</h2>${
    references.size
      ? [...references]
          .map((id) => {
            const s = sources.find((source) => source.id === id);
            return s
              ? `<article class="reference"><h3>${sourceLink(id)}</h3><p>${escape(s.date)} · ${escape(s.credit)}</p><p><strong>Source limit:</strong> ${escape(s.limitation)}</p></article>`
              : "";
          })
          .join("")
      : empty("No sources saved or attached yet.")
  }</section>
<section class="appendix"><p class="eyebrow">Appendix · reconstructed dialogue</p><h2>My conversations</h2><p class="caption">Student questions are preserved below. Character responses are educational reconstructions, not historical quotations.</p>${stages.map((stage, index) => `<h3>Chapter ${index + 1} · ${escape(stage.title)}</h3>${transcript(state.messages.filter((m) => m.stageIndex === index))}`).join("")}${state.messages.some((m) => m.stageIndex === null) ? `<h3>Earlier undated entries</h3>${transcript(state.messages.filter((m) => m.stageIndex === null))}` : ""}</section>
${legacy ? `<section class="appendix"><p class="eyebrow">Preserved earlier edition</p><h2>My earlier five-stage record</h2><p>This material was saved before the lesson was shortened. It is preserved here, separate from the current two chapters.</p>${legacy.decisions.map((d) => `<h3>${escape(oldNames[d.stage] ?? "Earlier stage")}</h3>${paragraph(oldChoices[d.choice] ?? d.choice)}${d.prediction ? paragraph(`Prediction: ${d.prediction}`) : ""}`).join("")}${legacy.chosen ? paragraph(`Pending earlier recommendation: ${oldChoices[legacy.chosen] ?? legacy.chosen}`) : ""}<h3>Earlier notes</h3>${notesHtml(legacy.notes)}<h3>Earlier conversations</h3>${transcript(legacy.messages)}</section>` : ""}
${state.previousEditionMessages?.length ? `<section class="appendix"><h2>Earlier fictional-character dialogue</h2><p class="caption">Preserved from an earlier demo. These entries are not attributed to the historical cast.</p>${transcript(state.previousEditionMessages)}</section>` : ""}
<footer>The Cost of Resistance · Standalone classroom demo · Keep claims, evidence and uncertainty distinct.</footer></main>
<script>document.getElementById('print-report').addEventListener('click',function(){window.print();});</script></body></html>`;
}
