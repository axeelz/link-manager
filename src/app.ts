import { LibsqlError } from "@libsql/client";
import { and, count, desc, eq, gte, max, sql, type SQL } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { timingSafeEqual } from "node:crypto";

import { CODE_PATTERN } from "./code";
import { db } from "./db";
import { links, visits } from "./schema";
import { describeUserAgent, isHumanVisit, visitorLocation } from "./visits";

const notFoundPage = await Bun.file(`${import.meta.dir}/../web/404.html`).text();

const production = Bun.env.NODE_ENV === "production";
if (production && !Bun.env.PASSWORD) throw new Error("Missing PASSWORD environment variable");
const PASSWORD = Bun.env.PASSWORD ?? "admin";

// Stateless session: the cookie holds a value only the server can derive from the password.
// Changing the password signs every device out.
const SESSION = new Bun.CryptoHasher("sha256", PASSWORD).update("session").digest("base64url");
const same = (a: string, b: string) => timingSafeEqual(Bun.SHA256.hash(a), Bun.SHA256.hash(b));
const isAdmin = (session?: string) => session !== undefined && same(session, SESSION);

const randomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(4)),
    (n) => "abcdefghijklmnopqrstuvwxyz"[n % 26],
  ).join("");

const linksWithVisits = (where?: SQL) =>
  db
    .select({
      id: links.id,
      code: links.code,
      url: links.url,
      createdAt: links.createdAt,
      visits: count(visits.id),
      lastVisit: max(visits.createdAt),
    })
    .from(links)
    .leftJoin(visits, eq(visits.linkId, links.id))
    .where(where)
    .groupBy(links.id)
    .orderBy(desc(links.id));

const linkBody = t.Object({
  url: t.String({ pattern: "^https?://[^\\s/?#]+\\S*$", error: "Enter a valid http(s) URL" }),
  code: t.Optional(
    t.String({ pattern: CODE_PATTERN, error: "Use up to 32 letters, digits, - or _" }),
  ),
});
const idParams = t.Object({ id: t.Number() });

export const app = new Elysia()
  .guard({ cookie: t.Cookie({ session: t.Optional(t.String()) }) })
  .onError(({ code, error, status }) => {
    // Plain text messages, ready to show in the UI
    if (code === "VALIDATION") return status(422, String(error.customError ?? "Invalid request"));
    if (
      error instanceof Error &&
      error.cause instanceof LibsqlError &&
      error.cause.code === "SQLITE_CONSTRAINT"
    )
      return status(409, "This code is already taken");
  })
  .get("/", ({ redirect }) => redirect("https://axeelz.com"))
  .get("/:code", async ({ params: { code }, request, cookie: { session }, redirect }) => {
    const link = await db.select().from(links).where(eq(links.code, code)).get();
    if (!link) {
      return new Response(
        notFoundPage.replace("{code}", () => Bun.escapeHTML(code)),
        {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    // Recorded without delaying the redirect. The owner's own clicks don't count.
    if (!isAdmin(session.value) && isHumanVisit(request)) {
      db.insert(visits)
        .values({
          linkId: link.id,
          referrer: request.headers.get("referer"),
          language: request.headers.get("accept-language")?.split(/[,;]/)[0],
          userAgent: request.headers.get("user-agent"),
          location: visitorLocation(request.headers),
        })
        .catch(console.error);
    }
    // Temporary on purpose: a 301 would be cached by browsers, hiding edits and visits.
    return redirect(link.url, 302);
  })
  .group("/api", (api) =>
    api
      // Fails when the database is unreachable, since redirects need it
      .get("/health", async () => {
        await db.run(sql`select 1`);
        return "ok";
      })
      .get(
        "/demo",
        async ({ status }) => (await linksWithVisits(eq(links.code, "demo")).get()) ?? status(404),
      )
      .post(
        "/login",
        async ({ body, cookie: { session }, status }) => {
          if (!same(body.password, PASSWORD)) {
            await Bun.sleep(1000);
            return status(401, "Wrong password");
          }
          session.set({
            value: SESSION,
            httpOnly: true,
            secure: production,
            sameSite: "lax",
            path: "/",
            maxAge: 400 * 24 * 60 * 60, // the longest browsers allow
          });
        },
        { body: t.Object({ password: t.String() }) },
      )
      .onBeforeHandle(({ cookie: { session }, status }) => {
        if (!isAdmin(session.value)) return status(401, "Unauthorized");
      })
      .post("/logout", ({ cookie: { session } }) => {
        session.remove();
      })
      .get("/links", () => linksWithVisits())
      .post(
        "/links",
        async ({ body: { url, code }, status }) => {
          // A generated code can collide with an existing one, then we simply draw another.
          for (let attempt = 0; attempt < 5; attempt++) {
            const link = await db
              .insert(links)
              .values({ url, code: code ?? randomCode() })
              .onConflictDoNothing()
              .returning()
              .get();
            if (link) return status(201, { ...link, visits: 0, lastVisit: null });
            if (code) break;
          }
          return status(409, "This code is already taken");
        },
        { body: linkBody },
      )
      .patch(
        "/links/:id",
        async ({ params: { id }, body, status }) =>
          (await db.update(links).set(body).where(eq(links.id, id)).returning().get()) ??
          status(404, "Link not found"),
        { params: idParams, body: linkBody },
      )
      .delete(
        "/links/:id",
        async ({ params: { id }, status }) => {
          // Visits are deleted explicitly rather than trusting the cascade to be enforced
          const [, deleted] = await db.batch([
            db.delete(visits).where(eq(visits.linkId, id)),
            db.delete(links).where(eq(links.id, id)).returning({ id: links.id }),
          ]);
          return deleted.length ? status(204) : status(404, "Link not found");
        },
        { params: idParams },
      )
      .get(
        "/links/:id/visits",
        async ({ params: { id } }) => {
          const day = sql<number>`${visits.createdAt} / 86400`; // days since epoch, UTC
          const [recent, daily] = await Promise.all([
            db
              .select({
                id: visits.id,
                createdAt: visits.createdAt,
                referrer: visits.referrer,
                language: visits.language,
                // v1 rows hold JSON, v2 rows the raw value
                userAgent: sql<
                  string | null
                >`iif(json_valid(${visits.userAgent}), ${visits.userAgent} ->> '$.ua', ${visits.userAgent})`,
                city: sql<string | null>`${visits.location} ->> '$.city'`,
                country: sql<string | null>`${visits.location} ->> '$.country'`,
              })
              .from(visits)
              .where(eq(visits.linkId, id))
              .orderBy(desc(visits.createdAt))
              .limit(50),
            db
              .select({ day, count: count() })
              .from(visits)
              // Today and the 29 days before, the days the admin chart shows
              .where(and(eq(visits.linkId, id), gte(day, sql`unixepoch() / 86400 - 29`)))
              .groupBy(day),
          ]);
          return {
            daily,
            recent: recent.map(({ userAgent, city, country, ...visit }) => ({
              ...visit,
              device: describeUserAgent(userAgent),
              location: [city, country].filter(Boolean).join(", ") || null,
            })),
          };
        },
        { params: idParams },
      ),
  );

export type App = typeof app;
