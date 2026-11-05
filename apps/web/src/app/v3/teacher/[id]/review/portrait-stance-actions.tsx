"use client";

import { useRef, useState } from "react";
import { compactButton as button } from "@/components/ui";
import type { V3Edit } from "@/lib/v3/edit/commands";
import type { MediaCandidate } from "@/lib/v3/media/repository";
import { createMediaAction } from "../media-actions";

export function PortraitStanceActions({ item, targets, adventureId, version, onEdit, onCandidate }: {
  item: MediaCandidate;
  targets: { key: string; label: string }[];
  adventureId: string;
  version: number;
  onEdit: (edit: V3Edit, candidate?: MediaCandidate) => void;
  onCandidate: (candidate: MediaCandidate) => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const requests = useRef(new Map<string, string>());
  const snapshot = item.snapshot;
  if (!snapshot || item.state !== "ready" || targets.length < 2) return null;
  async function generate() {
    if (!snapshot || running.current) return;
    running.current = true;
    setPending(true);
    setMessage("");
    let queued = 0;
    try {
      for (const target of targets.filter(target => target.key !== item.target.key)) {
        const fingerprint = `${version}:${target.key}`;
        const key = requests.current.get(fingerprint) ?? crypto.randomUUID();
        requests.current.set(fingerprint, key);
        const result = await createMediaAction(adventureId, {
          target: { kind: "portrait", key: target.key }, version, key,
          origin: "ai", referenceCandidateId: item.id,
          caption: target.label.slice(0, 2000), alt: target.label.slice(0, 1000),
          appearance: "Preserve the original portrait's identity and visual style; change only expression and posture for this stance.",
        });
        if (!result.item) throw Error(result.error ?? "Could not generate stances.");
        onCandidate(result.item);
        queued++;
      }
      setMessage(`${queued} stance candidates queued. Review each portrait before using it.`);
    } catch (cause) {
      setMessage(`${queued ? `${queued} candidates queued. ` : ""}${cause instanceof Error ? cause.message : "Could not generate stances."} Retry to continue.`);
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return <div className="space-y-2 border-t border-line pt-3" aria-busy={pending}>
    <button type="button" className={button.subtle} disabled={pending}
      onClick={() => onEdit({ type: "portraitImage", targetKey: item.target.key, candidateId: item.id, allStances: true }, item)}>
      Use for all stances
    </button>
    {snapshot.storageKey && snapshot.format !== "external" ? <>
      <p className="text-xs text-muted">Create {targets.length - 1} paid AI variants using this image as the reference, keeping the face, clothing and art style consistent.</p>
      <button type="button" className={button.subtle} disabled={pending} onClick={() => void generate()}>
        {pending ? "Queuing stances…" : "Generate other stances"}
      </button>
    </> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
