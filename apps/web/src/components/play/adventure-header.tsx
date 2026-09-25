import { Compass } from "lucide-react";
import Link from "next/link";
import { ThemeSelect } from "@/components/theme-provider";
import { button } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";
import styles from "./adventure-chrome.module.css";

export function AdventureHeader({ title, active, recap }: {
  title: string;
  active: Pick<PlayState, "stage" | "stageCount" | "revision"> | null;
  recap: string[];
}) {
  return (
    <header className={`${styles.header} shrink-0`}>
      <h1 className={styles.adventureTitle}>
        <span className={styles.headerEmblem}><Compass size={24} aria-hidden /></span>
        <span className="break-words">{title}</span>
      </h1>
      {active ? (
        <details data-walkthrough="story" className={`${styles.chapter} group`}>
          <summary>
            <span className={styles.chapterNumber}>Stage {active.stage.index + 1} of {active.stageCount}</span>
            <span className={styles.chapterTitle}>{active.stage.title}</span>
            <span className={styles.storyToggle}>
              <span className="group-open:hidden">The story so far</span>
              <span className="hidden group-open:inline">Close story</span>
            </span>
          </summary>
          <div className={styles.chapterStory}>
            <p>{active.stage.sharedContext}</p>
            {recap.length && active.revision > 0 ? (
              <ul className="mt-3 flex list-disc flex-col gap-1 pl-6">
                {recap.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}
      <div className={styles.headerActions}>
        <ThemeSelect />
        <Link href="/" className={button.subtle}>Leave</Link>
      </div>
    </header>
  );
}
