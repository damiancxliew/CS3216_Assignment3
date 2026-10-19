import { redirect } from "next/navigation";

// Preserve existing bookmarks; the adventure itself is now the workspace.
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/v3/teacher/${encodeURIComponent(id)}`);
}
