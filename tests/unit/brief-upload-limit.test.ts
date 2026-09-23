/** The client-side upload cap must stay in step with the extractor's, or files pass the chat check and still fail server-side. */
import { describe, expect, it } from "vitest";

import { LIMITS } from "@adventure/generation";

import { MAX_UPLOAD_BYTES } from "@/lib/brief/schema";

describe("MAX_UPLOAD_BYTES", () => {
  it("matches the extractor's upload cap", () => {
    expect(MAX_UPLOAD_BYTES).toBe(LIMITS.maxUploadBytes);
  });
});
