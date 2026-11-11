"use client";

import type { DocumentView, NoteView } from "@adventure/play-contract";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotePickup } from "@/components/play/v3/note-pickup";

export const BODY =
  "It is impossible to conceive a place combining more advantages: it is within a week's sail of China, still closer to Siam, Cochin-China, &c. in the very heart of the Archipelago, or as the Malays call it, it is “the Navel of the Malay countries” … the harbour, in every way superior, is filled with Shipping from all quarters …";

const QUESTION = {
  id: "q-port",
  prompt: "According to Raffles, why is Singapore a good place for a port?",
  options: [
    { id: "a", text: "It had rich gold mines." },
    { id: "b", text: "It sits in the heart of the region, a week's sail from China." },
    { id: "c", text: "A large city already stood there." },
    { id: "d", text: "Its land was good for farming." },
  ],
};

const NOTE: NoteView = {
  id: "n-port",
  text: "Singapore sits at the heart of the trade routes, and ships come from all quarters.",
  source: "document",
  stageIndex: 0,
  at: "2026-10-31T00:00:00.000Z",
};

function documentView(passed: boolean): DocumentView {
  return {
    id: "d-raffles",
    kind: "letter",
    title: "Raffles' letter to Colonel Addenbrooke",
    provenance: { masthead: null, date: "10 June 1819", sender: "Stamford Raffles", recipient: "Colonel Addenbrooke", place: "Singapore" },
    body: BODY,
    real: true,
    sourceLabel: "Raffles to Colonel Addenbrooke, Singapore, 10 June 1819. Printed in the Journal of the Straits Branch of the Royal Asiatic Society, vol. 2 (1878), p. 178.",
    glossary: [
      { term: "Archipelago", meaning: "a large group of islands" },
      { term: "Siam", meaning: "the old name for Thailand" },
      { term: "Cochin-China", meaning: "the old name for southern Vietnam" },
    ],
    open: true,
    readingCheck: passed
      ? { status: "passed", question: null, recovery: null, feedback: null, explanation: "Raffles says Singapore is in the very heart of the region, close to China and Siam, and its harbour is already full of ships." }
      : { status: "unanswered", question: QUESTION, recovery: null, feedback: null, explanation: null },
  };
}

export function ShowcaseReader() {
  const params = useSearchParams();
  const [passed, setPassed] = useState(false);
  const doc = documentView(passed);
  return (
    <main className="fixed inset-0" style={{ background: "transparent" }}>
      <style>{`html, body { background: transparent !important; } nextjs-portal { display: none !important; }
        ${params.get("zoom") ? `body { zoom: ${params.get("zoom")}; }` : ""}`}</style>
      <DocumentReader
        document={doc}
        documents={[doc]}
        onSelectDocument={() => {}}
        onClose={() => {}}
        noteCount={passed ? 1 : 0}
        hasDocumentNote={passed}
        onSubmitReadingCheck={(_submission, settled) => { setPassed(true); settled(true); }}
      />
      {passed ? <NotePickup note={NOTE} onOpen={() => {}} /> : null}
    </main>
  );
}
