import type { AdventureSpec, CheckIssue, Condition } from "../index.js";

/** Deterministic runtime constraints shared by editing and publishing. */
export function editableIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const nonempty = (text: string, path: string) => {
    if (!text.trim()) add("empty-field", path, "This field must not be empty.");
  };
  const atoms = (c: Condition): Condition[] =>
    "all" in c
      ? c.all.flatMap(atoms)
      : "any" in c
        ? c.any.flatMap(atoms)
        : "not" in c
          ? atoms(c.not)
          : [c];
  const minimumFacts = (c: Condition, firing: string | null): number =>
    "all" in c
      ? c.all.reduce((n, x) => n + minimumFacts(x, firing), 0)
      : "any" in c
        ? c.any.length
          ? Math.min(...c.any.map((x) => minimumFacts(x, firing)))
          : 0
        : "not" in c || ("discovered" in c && c.discovered === firing)
          ? 0
          : 1;
  spec.characters.forEach((character, i) => {
    if (character.tier !== "major") return;
    if (!character.trustNotice?.trim())
      add(
        "trust-notice",
        `characters.${i}.trustNotice`,
        "Write a trust notice for this character.",
      );
    if (!spec.triggers.some((t) => t.characterId === character.id))
      add(
        "trigger-count",
        `characters.${i}`,
        "This major character needs a trigger.",
      );
    const hidden = new Set(
      character.stances.filter((s) => s.hidden).map((s) => s.id),
    );
    for (const trigger of spec.triggers.filter(
      (t) => t.characterId === character.id,
    )) {
      // Firing on a discovery or its note already implies that discovery.
      const firing =
        "discovered" in trigger.on
          ? trigger.on.discovered
          : "notePassed" in trigger.on
            ? trigger.on.notePassed
            : null;
      if (
        "toStance" in trigger.effect &&
        hidden.has(trigger.effect.toStance) &&
        (!trigger.requires || minimumFacts(trigger.requires, firing) < 1)
      )
        add(
          "hidden-stance-guard",
          "triggers",
          "A trigger into a hidden stance needs at least one prerequisite in addition to its triggering action.",
        );
    }
  });
  spec.discoveries.forEach((d, i) => {
    if (!d.core || !d.condition) return;
    if (
      atoms(d.condition).some(
        (atom) =>
          "stanceAtLeast" in atom &&
          spec.characters
            .find((c) => c.id === atom.stanceAtLeast.characterId)
            ?.stances.some(
              (s) => s.id === atom.stanceAtLeast.stanceId && s.hidden,
            ),
      )
    )
      add(
        "core-condition",
        `discoveries.${i}.condition`,
        "A core discovery cannot require a hidden stance.",
      );
  });
  spec.documents.forEach((doc, i) => {
    if (doc.keyPassages.length < 1 || doc.keyPassages.length > 2)
      add(
        "passage-count",
        `documents.${i}.keyPassages`,
        "A document needs 1–2 key passages.",
      );
    doc.keyPassages.forEach((passage, j) => {
      if (passage.end > doc.body.length || passage.end <= passage.start)
        add(
          "passage-not-in-body",
          `documents.${i}.keyPassages.${j}`,
          "The passage must lie inside the document body.",
        );
      const links = spec.discoveries.filter(
        (d) =>
          "documentId" in d.holder &&
          d.holder.documentId === doc.id &&
          d.holder.keyPassageId === passage.id,
      );
      if (links.length !== 1)
        add(
          "passage-unlinked",
          `documents.${i}.keyPassages.${j}`,
          "Each key passage must link to exactly one discovery.",
        );
    });
  });
  spec.stages.forEach((stage, i) => {
    if (!spec.openQuestions.some((q) => q.stageId === stage.id))
      add(
        "open-questions",
        `stages.${i}`,
        "This stage needs an open question.",
      );
    for (const d of spec.discoveries.filter(
      (d) => d.stageId === stage.id && d.core,
    )) {
      if (!spec.hintAngles.some((a) => a.discoveryId === d.id))
        add(
          "hint-angle-missing",
          "hintAngles",
          `Core discovery '${d.id}' needs a hint angle.`,
        );
    }
    if (i === 0 && stage.situations.length)
      add(
        "ref",
        `stages.${i}.situations`,
        "The first stage cannot depend on an earlier outcome.",
      );
    stage.situations.forEach((s, j) => {
      const moment = spec.definingMoments.find(
        (m) => m.id === s.whenOutcome.momentId,
      );
      if (moment && spec.stages.findIndex((t) => t.id === moment.stageId) >= i)
        add(
          "ref",
          `stages.${i}.situations.${j}`,
          "Situation must reference an earlier stage.",
        );
    });
  });
  spec.hintAngles.forEach((hint, i) => {
    const discovery = spec.discoveries.find((d) => d.id === hint.discoveryId);
    if (
      discovery &&
      ((hint.kind === "ask" && !("characterId" in discovery.holder)) ||
        (hint.kind === "read" && !("documentId" in discovery.holder)))
    )
      add(
        "hint-angle-kind",
        `hintAngles.${i}`,
        "Choose a hint kind matching the discovery holder.",
      );
  });
  spec.definingMoments.forEach((m, i) => {
    const at = `definingMoments.${i}`;
    nonempty(m.nudge, `${at}.nudge`);
    nonempty(m.finalCallNarration, `${at}.finalCallNarration`);
    m.acts.forEach((a, j) => nonempty(a.reaction, `${at}.acts.${j}.reaction`));
    const predictions = new Set<string>();
    m.outcomes.forEach((o, j) => {
      const path = `${at}.outcomes.${j}`;
      nonempty(o.predictionText, `${path}.predictionText`);
      nonempty(o.because, `${path}.because`);
      if (o.predictionText.trim().split(/\s+/).length > 12)
        add(
          "prediction-long",
          `${path}.predictionText`,
          "Use at most 12 words.",
        );
      const key = o.predictionText.trim().toLowerCase();
      if (predictions.has(key))
        add(
          "prediction-duplicate",
          `${path}.predictionText`,
          "Predictions must be distinct.",
        );
      predictions.add(key);
    });
    for (const act of m.acts) {
      if (m.rules.filter((r) => r.actId === act.id && r.when).length > 2)
        add(
          "rule-count",
          at,
          "Each act may have at most two conditional rules.",
        );
      if (
        act.secret &&
        (act.secret.minMet > act.secret.unlock.length ||
          act.secret.unlock.length > 3)
      )
        add(
          "secret-unlock",
          at,
          "Secret unlock thresholds must fit the 2–3 conditions.",
        );
    }
    m.rules.forEach((r, j) => {
      if (!r.when) return;
      const path = `${at}.rules.${j}`;
      if (m.outcomes.find((o) => o.id === r.outcomeId)?.secret)
        add(
          "secret-rule",
          path,
          "Conditional rules cannot target secret outcomes.",
        );
      const fallback = m.rules.find((f) => f.actId === r.actId && !f.when);
      const historical = m.outcomes.find(
        (o) => o.id === fallback?.outcomeId,
      )?.historical;
      if (
        historical &&
        !m.outcomes.find((o) => o.id === r.outcomeId)?.historical
      )
        add(
          "historical-diverted",
          path,
          "A conditional rule must preserve the historical path.",
        );
      for (const atom of atoms(r.when)) {
        if ("discovered" in atom)
          add(
            "rule-discovered",
            path,
            "Rules must use evidence passed on rather than discovery alone.",
          );
        if ("discovered" in atom || "notePassed" in atom) {
          const id =
            "discovered" in atom
              ? atom.discovered
              : atom.notePassed.discoveryId;
          const d = spec.discoveries.find((d) => d.id === id);
          if (
            d &&
            spec.stages.findIndex((s) => s.id === d.stageId) >
              spec.stages.findIndex((s) => s.id === m.stageId)
          )
            add(
              "ref",
              path,
              "This evidence is only available in a later stage.",
            );
        }
      }
    });
  });
  spec.endings.forEach((ending, i) => {
    const at = `endings.${i}`;
    if (!ending.epilogue.trim().startsWith("Your simulation:"))
      add(
        "epilogue",
        `${at}.epilogue`,
        "Start the epilogue with “Your simulation:”.",
      );
    nonempty(ending.interview.interviewer, `${at}.interview.interviewer`);
    nonempty(ending.interview.question, `${at}.interview.question`);
    nonempty(ending.interview.generalCounter, `${at}.interview.generalCounter`);
    if (
      spec.characters.some(
        (c) =>
          c.name &&
          ending.interview.interviewer
            .toLowerCase()
            .includes(c.name.toLowerCase()),
      )
    )
      add(
        "interviewer-character",
        `${at}.interview.interviewer`,
        "The interviewer must not be a character the student met.",
      );
    const texts = new Set<string>();
    ending.interview.verdicts.forEach((v, j) => {
      const path = `${at}.interview.verdicts.${j}`;
      nonempty(v.text, `${path}.text`);
      const key = v.text.trim().toLowerCase();
      if (texts.has(key))
        add("verdict-duplicate", path, "Verdicts must be distinct.");
      texts.add(key);
      if (v.counterPoints.length < 1 || v.counterPoints.length > 3)
        add("counter-count", path, "Use 1–3 counterpoints.");
      if (
        !v.counterPoints.some(
          (id) => spec.discoveries.find((d) => d.id === id)?.core,
        )
      )
        add(
          "counter-core",
          path,
          "Include a core discovery among the counterpoints.",
        );
    });
  });
  if (
    spec.timer.enabled &&
    spec.timer.stageMinutes.length !== spec.stages.length
  )
    add(
      "timer-count",
      "timer.stageMinutes",
      "Provide a duration for each stage.",
    );
  if (spec.reveal) {
    nonempty(spec.reveal.whatHappened, "reveal.whatHappened");
    spec.reveal.corrections.forEach((text, i) =>
      nonempty(text, `reveal.corrections.${i}`),
    );
    spec.reveal.couldHaveGone.forEach((text, i) =>
      nonempty(text, `reveal.couldHaveGone.${i}`),
    );
    if (spec.reveal.interpretations.length < 2)
      add(
        "interpretations-few",
        "reveal.interpretations",
        "Provide at least two interpretations.",
      );
  }
  spec.teacherQuestions.forEach((text, i) =>
    nonempty(text, `teacherQuestions.${i}`),
  );
  return issues;
}
