import { isbot } from "isbot";
import { UAParser } from "ua-parser-js";

const PREFETCH = /prefetch|prerender|preview/i;
// Headless Chrome with a frozen version and a regular UA, used by link health checkers.
const FROZEN_CHECKER = /Chrome\/130\.0\.0\.0/;

/**
 * Only count what looks like a person opening the link in a browser.
 * Since 2023 every browser sends `Sec-Fetch-Mode: navigate` for a page load, most scripts don't.
 * Link previews, prefetches and declared bots are excluded on top of that.
 */
export function isHumanVisit(request: Request) {
  const header = (name: string) => request.headers.get(name) ?? "";
  const userAgent = header("user-agent");
  return (
    request.method === "GET" &&
    header("sec-fetch-mode") === "navigate" &&
    !["sec-purpose", "purpose", "x-purpose", "x-moz"].some((name) => PREFETCH.test(header(name))) &&
    userAgent !== "" &&
    !isbot(userAgent) &&
    !FROZEN_CHECKER.test(userAgent)
  );
}

/** Human readable summary of a raw User-Agent, e.g. "Safari · iOS". */
export function describeUserAgent(userAgent: string | null) {
  const { browser, os } = UAParser(userAgent ?? "");
  return [browser.name, os.name].filter(Boolean).join(" · ") || null;
}
