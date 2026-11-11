import { describe, expect, it } from "bun:test";

import { isHumanVisit } from "../src/visits";

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const visit = (headers: Record<string, string>, method = "GET") =>
  isHumanVisit(
    new Request("http://localhost/x", {
      method,
      headers: { "user-agent": SAFARI, "sec-fetch-mode": "navigate", ...headers },
    }),
  );

describe("isHumanVisit", () => {
  it("counts a browser navigation", () => {
    expect(visit({})).toBe(true);
  });

  it("ignores requests that are not page navigations", () => {
    expect(visit({ "sec-fetch-mode": "" })).toBe(false);
    expect(visit({ "sec-fetch-mode": "no-cors" })).toBe(false);
    expect(visit({}, "HEAD")).toBe(false);
  });

  it("ignores prefetches and link previews", () => {
    expect(visit({ "sec-purpose": "prefetch;prerender" })).toBe(false);
    expect(visit({ purpose: "prefetch" })).toBe(false);
    expect(visit({ "x-purpose": "preview" })).toBe(false);
  });

  it("ignores bots, even when they send browser headers", () => {
    expect(
      visit({ "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" }),
    ).toBe(false);
    expect(visit({ "user-agent": "curl/8.7.1" })).toBe(false);
    expect(visit({ "user-agent": "" })).toBe(false);
    expect(
      visit({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      }),
    ).toBe(false);
  });
});
