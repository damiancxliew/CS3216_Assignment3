"use client";
import { discoveries, type DiscoveryId } from "@/lib/demo/discoveries";
import { NewspaperDialog, NoticeboardDialog } from "./evidence-dialog";
import { SourceQuestion, SourceFootnote } from "./source-question";
import styles from "./waterfront-experience.module.css";

export function DiscoveryRecord({ id, onClose }: { id: DiscoveryId; onClose: () => void }) {
  const record = discoveries[id];
  const Frame = id === "shelter" ? NewspaperDialog : NoticeboardDialog;
  return <Frame title={record.title} eyebrow={record.date} onClose={onClose}
    closeLabel="Return to exploring" footerText="Examine the record · unlock a hint"
    masthead="The Singapore Free Press" boardLabel="Field collection · evidence desk"
    readingLabel="Reading companion · summary of a historical source">
    <div className={styles.activity}>
      <p>{record.context}</p>
      <SourceQuestion id={`discovery-${id}`} />
      <SourceFootnote id={`discovery-${id}`} />
      <p className={styles.credit} data-record-credit>
        <a href={record.url} target="_blank" rel="noreferrer">{record.credit} ↗</a>
      </p>
      {"contextUrl" in record && <p className={styles.credit} data-record-credit>
        <a href={record.contextUrl} target="_blank" rel="noreferrer">NLB historical context and oral histories ↗</a>
      </p>}
    </div>
  </Frame>;
}
