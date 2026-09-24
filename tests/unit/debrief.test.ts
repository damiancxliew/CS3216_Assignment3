import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadDebrief } from "@/lib/attempts/debrief";

function fixture(choice: "authored" | "minted" | "timeout", status = "completed") {
  const tables: Record<string, unknown[]> = {
    attempt: [{ id: "attempt", status, ending_id: "ending", adventure_id: "adventure", published_version: 1, adventure: { title: "Treaty" } }],
    spec_version: [{ json: {
      stages: [
        { index: 0, title: "Landing", evidence: [{ id: "first", name: "First account" }] },
        { index: 1, title: "Negotiation", evidence: [{ id: "second", name: "Treaty terms" }, { id: "unread", name: "Unread account" }] },
      ],
      endings: [{ id: "ending", title: "An agreement", summary: "A simulated agreement.", historicalOutcome: { text: "The historical record.", spans: [], assumptionIds: [] }, divergence: "Different terms.", reflectionQuestions: ["Whose interests did you consider?"] }],
    } }],
    resolution: [0, 1].map((index) => ({ stage_id: `stage-${index}`, stage: { index, title: index === 0 ? "Landing" : "Negotiation" }, outcome: { announcement: "A public outcome.", worldDeltas: [] } })),
    stage_commitment: [{ stage_id: "stage-1", option_id: choice === "authored" ? "authored" : null, minted_option_id: choice === "minted" ? "minted" : null, decision_option: choice === "authored" ? { label: "Sign the agreement" } : null, minted_option: choice === "minted" ? { label: "Negotiate revised terms" } : null }],
    attempt_state: [{ journal: [
      { id: "first", text: "First account: A perspective from the landing.", sourceSpan: "Account, p. 1" },
      { id: "second", text: "Treaty terms: The proposed terms.\n\nWho benefits?", sourceSpan: "Treaty, p. 2\n\nAccount, p. 3" },
      { id: "broken" },
    ] }],
  };
  const requests: URL[] = [];
  const client = createClient("https://debrief.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return new Response(JSON.stringify(tables[url.pathname.split("/").at(-1)!] ?? []), { headers: { "content-type": "application/json" } });
    } },
  });
  return { client, requests };
}

describe("debrief learning connections", () => {
  it.each([
    ["authored", "Sign the agreement"],
    ["minted", "Negotiate revised terms"],
    ["timeout", null],
  ] as const)("records a %s choice accurately", async (choice, label) => {
    const { client, requests } = fixture(choice);
    const debrief = await loadDebrief(client, "attempt", client);
    expect(debrief?.path[1]?.chose).toBe(label);
    expect(requests.find((url) => url.pathname.endsWith("stage_commitment"))?.searchParams.get("select")).toContain("minted_option(label)");
    expect(requests.find((url) => url.pathname.endsWith("spec_version"))?.searchParams.get("version")).toBe("eq.1");
  });

  it("keeps the collected text and excerpts, associates notes with their stages, and excludes unread evidence", async () => {
    const { client } = fixture("minted");
    const debrief = await loadDebrief(client, "attempt", client);
    expect(debrief?.path.map((stage) => stage.evidenceFound)).toEqual([1, 1]);
    expect(debrief?.collectedEvidence).toEqual([
      { id: "first", name: "First account", text: "A perspective from the landing.", sourceSpan: "Account, p. 1", stageTitle: "Landing" },
      { id: "second", name: "Treaty terms", text: "The proposed terms.\n\nWho benefits?", sourceSpan: "Treaty, p. 2\n\nAccount, p. 3", stageTitle: "Negotiation" },
    ]);
  });

  it("does not expose an ending or read private data for an unfinished attempt", async () => {
    const { client, requests } = fixture("authored", "active");
    expect(await loadDebrief(client, "attempt", client)).toBeNull();
    expect(requests).toHaveLength(1);
  });
});
