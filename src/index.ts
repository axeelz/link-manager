import about from "../web/about.html";
import admin from "../web/admin.html";
import { app } from "./app";

const server = Bun.serve({
  port: 3500,
  routes: { "/about": about, "/admin": admin },
  fetch: app.fetch,
});

console.log(`Link manager running on ${server.url}`);
