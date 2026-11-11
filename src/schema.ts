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

export const visits = sqliteTable(
  "visits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linkId: integer("link_id")
      .references(() => links.id, { onDelete: "cascade" })
      .notNull(),
    city: text("city"),
    country: text("country"),
    language: text("language"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    createdAt,
  },
  (table) => [index("visits_link_id_created_at_idx").on(table.linkId, table.createdAt)],
);
