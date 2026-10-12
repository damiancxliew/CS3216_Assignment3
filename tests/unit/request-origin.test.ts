import { describe, expect, it } from "vitest";

import { requestOrigin } from "@/lib/auth/request-origin";

describe("requestOrigin", () => {
  it("prefers the forwarded host and protocol over the request URL", () => {
    const request = new Request("https://localhost:3000/x", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "54-206-194-219.sslip.io",
        "x-forwarded-proto": "https",
      },
    });

    expect(requestOrigin(request)).toBe("https://54-206-194-219.sslip.io");
  });

  it("uses the host header with the request URL's protocol", () => {
    const request = new Request("http://localhost:3000/x", {
      headers: { host: "app.test" },
    });

    expect(requestOrigin(request)).toBe("http://app.test");
  });

  it("falls back to the request URL origin when no host headers are present", () => {
    const request = new Request("https://localhost:3000/x");

    expect(requestOrigin(request)).toBe("https://localhost:3000");
  });

  it("takes the first value from comma-separated forwarded headers", () => {
    const request = new Request("https://localhost:3000/x", {
      headers: {
        "x-forwarded-host": "app.test, internal.test",
        "x-forwarded-proto": "https, http",
      },
    });

    expect(requestOrigin(request)).toBe("https://app.test");
  });

  it("falls back when the host cannot be parsed", () => {
    const request = new Request("https://localhost:3000/x", {
      headers: { host: "bad host/" },
    });

    expect(requestOrigin(request)).toBe("https://localhost:3000");
  });

  it("falls back when the forwarded protocol is not HTTP or HTTPS", () => {
    const request = new Request("https://localhost:3000/x", {
      headers: {
        "x-forwarded-host": "app.test",
        "x-forwarded-proto": "javascript",
      },
    });

    expect(requestOrigin(request)).toBe("https://localhost:3000");
  });
});
