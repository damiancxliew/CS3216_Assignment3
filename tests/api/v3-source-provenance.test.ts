import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";

describe("v3 source loading", () => {
  it("retains provenance and optional URLs from sources_v3", async () => {
    const base = {
      kind: "text",
      storage_key: null,
      content_hash: "hash",
      pages: [{ page: 1, text: "Source text" }],
    };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      returns: async () => ({
        data: [
          {
            ...base,
            source_key: "upload",
            origin: "upload",
            title: "Teacher handout",
            url: null,
          },
          {
            ...base,
            source_key: "outside",
            origin: "outside",
            title: "Outside source",
            url: "https://example.com/history",
          },
        ],
        error: null,
      }),
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    const loaded = await supabaseV3SourceStore(() => client).load("adventure");
    expect(loaded[0]).toMatchObject({
      id: "upload",
      origin: "teacher",
      title: "Teacher handout",
    });
    expect(loaded[0]).not.toHaveProperty("url");
    expect(loaded[1]).toMatchObject({
      id: "outside",
      origin: "outside",
      url: "https://example.com/history",
    });
  });
});
