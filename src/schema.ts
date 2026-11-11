import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Seconds since epoch. Plain numbers survive JSON, Dates would come back as strings.
const createdAt = integer("created_at")
  .notNull()
  .default(sql`(unixepoch())`);

export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").unique().notNull(),
  url: text("url").notNull(),
  createdAt,
});

// The table is still named "redirects" from v1, renaming it is not worth a data migration.
export const visits = sqliteTable(
  "redirects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linkId: integer("link_id")
      .references(() => links.id, { onDelete: "cascade" })
      .notNull(),
    location: text("location"), // JSON with city and country
    language: text("language"),
    referrer: text("referrer"),
    userAgent: text("user_agent"), // v1 stored ua-parser-js JSON, v2 stores the raw header
    createdAt,
  },
  (table) => [index("redirects_link_id_created_at_idx").on(table.linkId, table.createdAt)],
);
