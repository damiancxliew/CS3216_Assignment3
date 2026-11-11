"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Trash2 } from "lucide-react";
import { currentSlot, type BriefStateV3 } from "@/lib/v3/brief/schema";
import { Pending, StableLabel } from "@/components/ui";
import { V3BriefChat, type BriefChatActions } from "./brief-chat";
import { ReviewChatProvider } from "./review-chat-context";
import { ConfirmButton } from "./confirm-button";
import { BriefOverview } from "./brief-overview";
import { useBriefUploads } from "./use-brief-uploads";
import styles from "./creation-workspace.module.css";
import { ReviewToolbar, ReviewToolbarProvider } from "./review-toolbar";
import { reviewCreate } from "./creation-styles";

/**
 * Brings each step into view from its top, so the teacher can read everything
 * that step produced: when the current step changes or finishes generating
 * (the section marked `data-generation-current`), and when a new brief card
 * appears. Nothing else moves the pane, so opening or editing cards never does.
 */
function useStepScroll(content: HTMLElement | null, body: HTMLElement | null) {
  useEffect(() => {
    if (!content || !body) return;
    const target = (): { key: string; node: Element } | null => {
      const current = body.querySelector("[data-generation-current]");
      if (current) return { key: `${current.getAttribute("data-generation-section")}:${current.getAttribute("data-generation-current")}`, node: current };
      const steps = body.querySelectorAll("[data-brief-step]");
      const last = steps[steps.length - 1];
      return last ? { key: `brief:${steps.length}`, node: last } : null;
    };
    // Glide to each new step; land instantly on first load or when motion is reduced.
    const toTop = (node: Element, smooth: boolean) => {
      // Room below a short last step, so its top can always reach the top of the pane.
      body.style.paddingBottom = "0px";
      const below = body.getBoundingClientRect().bottom - node.getBoundingClientRect().top;
      body.style.paddingBottom = `${Math.max(0, content.clientHeight - below)}px`;
      const top = content.scrollTop + node.getBoundingClientRect().top - content.getBoundingClientRect().top;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      content.scrollTo({ top, behavior: smooth && !reduced ? "smooth" : "auto" });
    };
    let seen: string | null = null;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = target();
        if (!next || next.key === seen) return;
        const first = seen === null;
        seen = next.key;
        toTop(next.node, !first);
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-generation-current"] });
    check();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [content, body]);
}

/** The same two panes survive every refresh from briefing through review. */
export function CreationWorkspace({
  brief,
  active,
  statusMessage,
  generating,
  complete = false,
  failed = false,
  children,
  generationProgress,
  contentHeader,
}: {
  brief: BriefStateV3;
  active: boolean;
  statusMessage: string;
  generating: boolean;
  complete?: boolean;
  failed?: boolean;
  children: ReactNode;
  generationProgress?: ReactNode;
  contentHeader?: ReactNode;
}) {
  const [liveBrief, setLiveBrief] = useState(brief);
  const [busy, setBusy] = useState(false);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [contentBody, setContentBody] = useState<HTMLDivElement | null>(null);
  const actions = useRef<BriefChatActions>(null);
  const uploads = useBriefUploads({ adventureId: brief.adventureId, sourceCount: liveBrief.sources.length, onState: setLiveBrief });
  const starting = active && startingGeneration;
  const disabled = busy || uploads.busy || starting;
  const slot = currentSlot(liveBrief.draft);
  const ready = active && slot.name === "confirm";
  useStepScroll(content, contentBody);

  return (
    <ReviewToolbarProvider progress={generationProgress ?? null} busy={generating || starting}>
    <ReviewChatProvider>
      <div className={styles.workspace} data-creation-workspace>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{liveBrief.draft.episode ?? "New adventure"}</h1>
            {active ? <ConfirmButton
              label={<Trash2 size={16} aria-hidden />}
              ariaLabel="Discard brief"
              className={styles.discard}
              title="Discard this brief?"
              body="The conversation and any sources you added are thrown away."
              confirmLabel="Discard"
              disabled={disabled || generating}
              onConfirm={() => actions.current?.discard()}
            /> : null}
          </div>
          <span className={`${styles.status} ${ready || complete ? styles.ready : ""} ${failed ? styles.stopped : ""}`}>
            {ready || complete ? <Check size={14} aria-hidden /> : null}
            {generating || starting ? "Creating" : ready ? "Brief ready" : active ? "The brief" : complete ? "Ready" : failed ? "Stopped" : "Review"}
          </span>
        </header>
        <div className={styles.panes}>
          <section aria-label="Adventure conversation" className={styles.chat}>
            <V3BriefChat
              initial={brief}
              controlledState={liveBrief}
              active={active}
              statusMessage={statusMessage}
              generating={generating || starting}
              reviewIdleHint={failed ? "Generation stopped. Start again to make changes." : undefined}
              uploads={uploads}
              actionsRef={actions}
              onBusyChange={setBusy}
              onStateChange={setLiveBrief}
              onGenerationStart={() => setStartingGeneration(true)}
              onGenerationError={() => setStartingGeneration(false)}
            />
          </section>
          <section aria-label="Generated content" className={styles.right}>
            {contentHeader ? <div className={styles.contentHeader}>{contentHeader}</div> : null}
            <div ref={setContent} data-generated-content className={styles.content}>
              <div ref={setContentBody} className={styles.contentBody}>
                {active ? <BriefOverview brief={liveBrief} disabled={disabled} onChange={slot => actions.current?.change(slot)} onFiles={slot.name === "sources" ? uploads.addFiles : undefined} onRemove={slot.name === "sources" ? (id) => void uploads.remove(id) : undefined} removing={uploads.removing} removeError={uploads.removeError} /> : children}
              </div>
            </div>
            {/* Create uses the same bottom bar that carries Continue later. */}
            {ready ? <ReviewToolbar
              discard={null}
              resolve={null}
              disabled={disabled}
              primary={<button type="button" onClick={() => actions.current?.create()} className={reviewCreate}>
                <StableLabel label="Create adventure" pending={starting} pendingLabel={<Pending>Creating…</Pending>} />
              </button>}
            /> : null}
            <div data-review-dock className={styles.dock} />
          </section>
        </div>
      </div>
    </ReviewChatProvider>
    </ReviewToolbarProvider>
  );
}
