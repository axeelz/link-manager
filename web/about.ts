import { treaty } from "@elysiajs/eden";

import type { App } from "../src/app";

const { api } = treaty<App>(location.origin);
const section = document.getElementById("demo")!;
const counter = document.getElementById("demo-count")!;
const number = new Intl.NumberFormat("en").format;

async function refresh() {
  const { data } = await api.demo.get();
  if (!data) return;
  const visits = number(data.visits);
  const changed = !section.hidden && counter.textContent !== visits;
  counter.textContent = visits;
  section.hidden = false;
  if (changed && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    counter.animate(
      [
        { transform: "translateY(24%)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }
}

void refresh();
// Coming back from the demo link shows the visit that was just counted,
// and the number keeps moving while the page is open
document.addEventListener(
  "visibilitychange",
  () => document.visibilityState === "visible" && refresh(),
);
setInterval(() => document.visibilityState === "visible" && refresh(), 10_000);
