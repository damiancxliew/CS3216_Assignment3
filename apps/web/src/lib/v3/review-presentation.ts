import type {
  AdventureSpec,
  CheckIssue,
  SpecStoryEvent,
} from "@adventure/spec-v3";
import { reviewDiscoveryTitle, reviewStanceId } from "./review";

/** Labels for people; the original ids remain available as secondary references. */
export function reviewNames(spec: AdventureSpec): Map<string, string> {
  const names = new Map<string, string>([["held", "Carried by the student"]]);
  for (const [i, stage] of spec.stages.entries()) {
    names.set(stage.id, stage.title || `Stage ${i + 1}`);
    for (const [j, room] of stage.rooms.entries())
      names.set(room.id, room.name || `Room ${j + 1}`);
  }
  for (const [i, character] of spec.characters.entries()) {
    names.set(character.id, character.name || `Character ${i + 1}`);
    for (const [j, stance] of character.stances.entries())
      names.set(
        reviewStanceId(character.id, stance.id),
        stance.label || `Stance ${j + 1}`,
      );
    for (const [j, slant] of character.slants.entries())
      names.set(slant.id, slant.claim || `Claim ${j + 1}`);
  }
  for (const [i, doc] of spec.documents.entries()) {
    const title = doc.title || `Document ${i + 1}`;
    names.set(doc.id, title);
    for (const [j, passage] of doc.keyPassages.entries())
      names.set(passage.id, `Passage ${j + 1} · ${title}`);
  }
  for (const discovery of spec.discoveries)
    names.set(discovery.id, reviewDiscoveryTitle(spec, discovery));
  for (const [i, moment] of spec.definingMoments.entries()) {
    names.set(moment.id, `Decision ${i + 1}`);
    for (const [j, act] of moment.acts.entries())
      names.set(act.id, act.text || `Choice ${j + 1}`);
    for (const [j, outcome] of moment.outcomes.entries())
      names.set(outcome.id, outcome.summary || `Outcome ${j + 1}`);
  }
  for (const [i, ending] of spec.endings.entries()) {
    names.set(ending.id, ending.title || `Ending ${i + 1}`);
    for (const [j, verdict] of ending.interview.verdicts.entries())
      names.set(verdict.id, verdict.text || `Interview response ${j + 1}`);
  }
  for (const [i, source] of spec.sources.entries())
    names.set(source.id, source.title || `Source ${i + 1}`);
  return names;
}

export const REVIEW_PASS_LABELS: Record<string, string> = {
  sources: "Sources",
  skeleton: "Story outline",
  details: "Stages and characters",
  endings: "Endings",
  reveal: "Historical context",
  check: "Story checks",
  save: "Saving",
};

export const REVIEW_EVENT_LABELS: Record<SpecStoryEvent["effect"], string> = {
  summons: "A character calls the student",
  move: "A character moves",
  deliverDocument: "A document is delivered",
  news: "News arrives",
  beginMoment: "A decision begins",
};

const issueMessages: Record<string, string> = {
  "core-missing":
    "This stage needs an essential discovery for students to find.",
  "core-holder":
    "An essential discovery needs to come from a main character or a document.",
  "core-holder-absent":
    "The character sharing an essential discovery is missing from this stage.",
  "core-unreachable":
    "Students cannot currently reach this essential discovery.",
  "core-uncited":
    "An essential discovery needs a supporting quotation from a source.",
  "core-invented":
    "An essential discovery is marked as invented. Check its historical basis.",
  "core-condition":
    "An essential discovery should be available without extra conditions.",
  "core-link": "Check how students can find this essential discovery.",
  "source-label":
    "The source information is missing. Identify where this content came from.",
  "quote-not-in-source":
    "A quotation could not be matched to its source. Check the wording.",
  "quote-mismatch":
    "A quotation could not be matched to its source. Check the wording.",
  "real-uncited":
    "This historical document needs a supporting quotation from a source.",
  "historical-uncited":
    "The historical ending needs a supporting quotation from a source.",
  "passage-offsets": "A highlighted passage does not match the document text.",
  "passage-not-in-body":
    "A highlighted passage does not match the document text.",
  "passage-unlinked": "This highlighted passage does not lead to a discovery.",
  "passage-count":
    "Review the number of highlighted passages in this document.",
  "room-count": "This stage needs between 2 and 5 rooms.",
  "stance-count": "This main character needs between 3 and 5 stances.",
  "initial-stance": "This character needs an initial stance.",
  "minor-stances": "Supporting characters should not have changing stances.",
  "hidden-stance": "Only the final stance should be hidden from students.",
  "hidden-stance-guard":
    "Check how the character’s hidden stance becomes available.",
  "decider-absent":
    "The main character making this decision is missing from the stage.",
  "outcome-count": "This decision needs between 3 and 4 possible outcomes.",
  "historical-outcome":
    "Identify exactly one outcome that matches what happened in history.",
  "historical-missing":
    "The adventure needs an ending that follows the historical events.",
  "historical-unreachable":
    "Students cannot currently reach the historical ending.",
  "historical-diverted":
    "Check whether students can still follow the historical events.",
  "historical-hidden":
    "The historical outcome should be available without a hidden choice.",
  "rule-coverage":
    "A choice or outcome is not connected to the rest of the story.",
  "fallback-rule":
    "A choice needs a default outcome when no other conditions apply.",
  "final-outcome-ending":
    "An outcome in the final decision needs to lead to an ending.",
  "timer-stages": "Check the time limit for each stage.",
  "paths-overflow":
    "There are too many possible story paths to check automatically.",
  "stage-count":
    "This adventure may have too many stages for a 45-minute lesson.",
  "act-count": "Check the number of choices offered at this decision.",
  "core-count": "This stage may have too many essential discoveries.",
  "document-mix": "Check the balance of historical and invented documents.",
  placement: "A character or document is missing a location in this stage.",
  epilogue: "Review the account of what happens after this ending.",
  "empty-field": "Some story text is missing.",
  missing: "Part of the story is missing.",
  schema: "Some adventure content is incomplete or could not be read.",
  "duplicate-id":
    "Two pieces of content share the same reference and may be confused with each other.",
  "id-prefix": "A story reference needs to be corrected.",
  "skeleton-changed":
    "Some generated details no longer match the agreed story outline.",
  "secret-unlock": "Check the conditions for revealing this hidden choice.",
  "secret-leak": "A hidden part of the story is revealed too early.",
  "correction-missing":
    "The historical explanation needs to address this invented or misleading claim.",
  "teacher-questions": "Review the suggested class discussion questions.",
  "interpretations-few": "The historical explanation needs more perspectives.",
};

/** Preserve concise human messages; keep model/validator diagnostics in Details. */
export function reviewIssueMessage(issue: CheckIssue): string {
  if (issueMessages[issue.code]) return issueMessages[issue.code];
  if (issue.code === "ref") {
    if (/source/i.test(issue.message))
      return "A cited source is missing or unavailable.";
    if (/key passage/i.test(issue.message))
      return "A discovery refers to a passage that is missing from its document.";
    return "A story connection points to content that is missing or in the wrong place.";
  }
  if (/^quote-/.test(issue.code))
    return "A quotation needs to be checked against its source.";
  if (/^(rule-|rules-)/.test(issue.code))
    return "Check how the student’s choices lead to the possible outcomes.";
  if (/^(counter-|verdict-)/.test(issue.code))
    return "Check the interview responses and their supporting evidence.";
  if (/^(trigger-|duplicate-trigger)/.test(issue.code))
    return "Check how the character reacts to the student’s actions.";
  if (/^(hint-|open-questions)/.test(issue.code))
    return "Check the guidance available to students in this stage.";
  const technical =
    /LOCAL FIXTURE|\b[a-z0-9]+(?:[-_][a-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z]*\b|\b(?:schema|JSON|undefined|null|expected|received)\b|\b[GPD]\d+(?:\.\d+)?\b/;
  if (issue.message.trim() && !technical.test(issue.message))
    return issue.message;
  return "This check reported a problem but did not explain what to change.";
}
