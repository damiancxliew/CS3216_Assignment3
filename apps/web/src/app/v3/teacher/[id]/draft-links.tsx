import Link from "next/link";
import { Eye, PencilRuler } from "lucide-react";
import { compactButton as button } from "@/components/ui";

/** The finished draft's next steps, shown in the bottom bar beside Save. */
export function DraftLinks({ adventureId }: { adventureId: string }) {
  return (
    <>
      <Link className={button.quiet} href={`/v3/teacher/${adventureId}/preview`} aria-label="Preview adventure" title="Preview adventure">
        <Eye aria-hidden size={16} />Preview
      </Link>
      <Link className={button.subtle} href={`/v3/teacher/${adventureId}?view=editor`} aria-label="Open adventure editor" title="Open adventure editor">
        <PencilRuler aria-hidden size={16} />Open editor
      </Link>
    </>
  );
}
