import { treaty } from "@elysiajs/eden";
import { describe, expect, it } from "bun:test";

import { app } from "../src/app";

const BROWSER = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "sec-fetch-mode": "navigate",
};

const anonymous = treaty(app).api;
const { response } = await anonymous.login.post({ password: "admin" });
const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
const api = treaty(app, { headers: { cookie } }).api;

const open = (code: string, headers: Record<string, string> = BROWSER) =>
  app.handle(new Request(`http://localhost/${code}`, { headers }));
const visitCount = async (id: number) => (await api.links({ id }).visits.get()).data?.recent.length;

describe("redirects", () => {
  it("redirects temporarily and counts human visits only", async () => {
    const { data: link } = await api.links.post({
      url: "https://example.com/page",
      code: "redirect-test",
    });

    const response = await open("redirect-test");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/page");

    await open("redirect-test", { "user-agent": "curl/8.7.1" });
    await open("redirect-test", { ...BROWSER, cookie });
    expect(await visitCount(link!.id)).toBe(1);
  });

  it("describes the device and location of a visit", async () => {
    const { data: link } = await api.links.post({
      url: "https://example.com",
      code: "location-test",
    });
    await open("location-test", { ...BROWSER, "cf-ipcountry": "DE", "cf-ipcity": "Berlin" });

    const { data } = await api.links({ id: link!.id }).visits.get();
    expect(data?.recent).toMatchObject([{ device: "Safari · macOS", location: "Berlin, Germany" }]);
  });

  it("answers unknown codes with a 404 page", async () => {
    const response = await open("missing");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("/missing");
  });
});

describe("auth", () => {
  it("rejects a wrong password", async () => {
    const { status } = await anonymous.login.post({ password: "nope" });
    expect(status).toBe(401);
  });

  it("protects admin routes but not the public demo", async () => {
    expect((await anonymous.links.get()).status).toBe(401);
    expect((await anonymous.links({ id: 1 }).delete()).status).toBe(401);
    expect((await anonymous.demo.get()).status).toBe(404);
  });
});

describe("links", () => {
  it("generates a code when none is given", async () => {
    const { data } = await api.links.post({ url: "https://example.com" });
    expect(data?.code).toMatch(/^[a-z]{4}$/);
  });

  it("rejects reserved codes, unsafe codes and invalid URLs", async () => {
    for (const code of ["admin", "api", "a/b", "a b"]) {
      expect((await api.links.post({ url: "https://example.com", code })).status).toBe(422);
    }
    for (const url of ["javascript:alert(1)", "https://", "https:// example.com"]) {
      expect((await api.links.post({ url })).status).toBe(422);
    }
    expect((await api.links.post({ url: "https://example.com/café" })).status).toBe(201);
  });

  it("refuses a code that is already taken, on create and on update", async () => {
    await api.links.post({ url: "https://example.com", code: "taken" });
    const { data: other } = await api.links.post({ url: "https://example.com", code: "other" });

    expect((await api.links.post({ url: "https://example.com", code: "taken" })).status).toBe(409);
    expect(
      (await api.links({ id: other!.id }).patch({ url: "https://example.com", code: "taken" }))
        .status,
    ).toBe(409);
  });

  it("updates then deletes a link", async () => {
    const { data: link } = await api.links.post({ url: "https://example.com", code: "before" });

    const { data: updated } = await api
      .links({ id: link!.id })
      .patch({ url: "https://example.org", code: "after" });
    expect(updated).toMatchObject({ code: "after", url: "https://example.org" });

    expect((await api.links({ id: link!.id }).delete()).status).toBe(204);
    expect((await api.links({ id: link!.id }).delete()).status).toBe(404);
  });
});
