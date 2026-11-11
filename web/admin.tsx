import { treaty, type Treaty } from "@elysiajs/eden";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { createRoot } from "react-dom/client";

import type { App } from "../src/app";

import { CODE_PATTERN } from "../src/code";

// Dates travel as numbers, so no string (like a "2026-11-11" code) should become a Date
const { api } = treaty<App>(location.origin, { parseDate: false });
type Link = Treaty.Data<typeof api.links.get>[number];
type Visits = Treaty.Data<ReturnType<typeof api.links>["visits"]["get"]>;

const codeRegex = new RegExp(CODE_PATTERN);
const number = new Intl.NumberFormat("en").format;
// No autofocus on touch screens, it would open the keyboard on arrival
const finePointer = matchMedia("(pointer: fine)").matches;
const regions = new Intl.DisplayNames(["en"], { type: "region" });
// Each letter of an ISO country code maps to a regional indicator symbol, which pair into a flag
const flag = (country: string) =>
  String.fromCodePoint(...[...country].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
const pretty = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const UNITS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const;
const relative = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "auto" });
function ago(timestamp: number) {
  const seconds = timestamp - Date.now() / 1000;
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ["second", 1];
  return unit === "second" ? "just now" : relative.format(Math.round(seconds / size), unit);
}

function useToast() {
  // The text stays while the toast fades out
  const [toast, setToast] = useState({ text: "", visible: false });
  const timer = useRef<Timer>(undefined);
  const notify = (text: string) => {
    clearTimeout(timer.current);
    setToast({ text, visible: true });
    timer.current = setTimeout(() => setToast(({ text }) => ({ text, visible: false })), 2400);
  };
  const element = (
    <output className="toast" data-visible={toast.visible}>
      {toast.text}
    </output>
  );
  return [element, notify] as const;
}

function copy(code: string) {
  return navigator.clipboard.writeText(`${location.origin}/${code}`);
}

function App() {
  const [links, setLinks] = useState<Link[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "offline">("loading");

  async function load() {
    const { data, status } = await api.links.get();
    if (data) setLinks(data);
    setState(data ? "ready" : status === 401 ? "signed-out" : "offline");
  }

  useEffect(() => {
    void load();
    // Fresh counts every time the tab comes back into view
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (state === "signed-out") return <SignIn onSignIn={load} />;
  if (state === "offline")
    return (
      <main className="center">
        <p>Couldn’t reach the server.</p>
        <button className="button" onClick={load}>
          Retry
        </button>
      </main>
    );
  if (state === "loading") return null;

  return (
    <Dashboard
      links={links}
      setLinks={setLinks}
      onSignOut={async () => {
        await api.logout.post();
        setState("signed-out");
      }}
    />
  );
}

function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await api.login.post({
      password: String(new FormData(event.currentTarget).get("password")),
    });
    setPending(false);
    if (error) return setError(String(error.value));
    onSignIn();
  }

  return (
    <main className="center">
      <form className="sign-in" onSubmit={submit}>
        <h1>{location.host}</h1>
        <input
          className="input"
          type="password"
          name="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          autoFocus={finePointer}
        />
        {error && (
          <p className="hint error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={pending}>
          Sign in
        </button>
      </form>
    </main>
  );
}

function Dashboard({
  links,
  setLinks,
  onSignOut,
}: {
  links: Link[];
  setLinks: Dispatch<SetStateAction<Link[]>>;
  onSignOut: () => void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [toast, notify] = useToast();
  const input = useRef<HTMLInputElement>(null);

  // "https://example.com" creates a link with a random code, "https://example.com docs" picks the code
  const [first = "", code, ...extra] = query.trim().split(/\s+/);
  const isUrl = /^https?:\/\/./.test(first) && URL.canParse(first);
  const invalidCode = isUrl && (extra.length > 0 || (code !== undefined && !codeRegex.test(code)));
  const terms = query.trim().toLowerCase().split(/\s+/);
  const shown = links.filter((link) =>
    terms.every((term) => `${link.code} ${link.url}`.toLowerCase().includes(term)),
  );
  const totalVisits = links.reduce((sum, link) => sum + link.visits, 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (
        (event.key === "/" && !typing) ||
        (event.key === "k" && (event.metaKey || event.ctrlKey))
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || !isUrl || invalidCode) return;
    setPending(true);
    const { data, error } = await api.links.post({ url: first, code });
    setPending(false);
    if (error) return setError(String(error.value));
    setLinks((current) => [data, ...current]);
    setQuery("");
    const short = `${location.host}/${data.code}`;
    copy(data.code).then(
      () => notify(`Created and copied ${short}`),
      () => notify(`Created ${short}, use the copy button to copy it`),
    );
  }

  return (
    <main className="page">
      <header className="top">
        <h1>{location.host}</h1>
        <p className="meta">
          {number(links.length)} links · {number(totalVisits)} visits
        </p>
        <button className="text-button" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <form className="command" onSubmit={create}>
        <input
          ref={input}
          className="input"
          placeholder="Paste a URL to shorten, or search"
          aria-label="Paste a URL to shorten, or search"
          aria-describedby="command-hint"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          readOnly={pending}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={finePointer}
        />
        <kbd className="shortcut" aria-hidden="true">
          /
        </kbd>
        <p
          id="command-hint"
          className={error || invalidCode ? "hint error" : "hint"}
          aria-live="polite"
        >
          {error ??
            (invalidCode ? (
              "Codes are one word: up to 32 letters, digits, - or _"
            ) : pending ? (
              "Creating…"
            ) : isUrl ? (
              <>
                Press ↵ to create <strong>{`${location.host}/${code ?? "····"}`}</strong>
              </>
            ) : (
              "Paste a URL, press ↵. Add a word to pick the code."
            ))}
        </p>
      </form>

      {links.length === 0 ? (
        <p className="empty">No links yet. Paste a URL above to create the first one.</p>
      ) : shown.length === 0 && !isUrl ? (
        <p className="empty">No link matches “{query.trim()}”.</p>
      ) : (
        <ul className="links">
          {shown.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              notify={notify}
              onSaved={(saved) =>
                setLinks((current) => current.map((item) => (item.id === saved.id ? saved : item)))
              }
              onDeleted={() => setLinks((current) => current.filter((item) => item.id !== link.id))}
            />
          ))}
        </ul>
      )}
      {toast}
    </main>
  );
}

function LinkRow({
  link,
  notify,
  onSaved,
  onDeleted,
}: {
  link: Link;
  notify: (message: string) => void;
  onSaved: (link: Link) => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="row">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="code">/{link.code}</span>
          <span className="count">
            {number(link.visits)}{" "}
            <span className="unit">{link.visits === 1 ? "visit" : "visits"}</span>
          </span>
          <span className="url">{pretty(link.url)}</span>
          <span className="when">{link.lastVisit && ago(link.lastVisit)}</span>
        </summary>
        {open && <LinkPanel link={link} notify={notify} onSaved={onSaved} onDeleted={onDeleted} />}
      </details>
      <CopyButton code={link.code} notify={notify} />
    </li>
  );
}

function CopyButton({ code, notify }: { code: string; notify: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      data-copied={copied}
      aria-label={`Copy ${location.host}/${code}`}
      onClick={() =>
        copy(code).then(
          () => {
            setCopied(true);
            notify(`Copied ${location.host}/${code}`);
            setTimeout(() => setCopied(false), 1500);
          },
          () => notify("Couldn’t copy, try again"),
        )
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="12" height="12" rx="3" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

function LinkPanel({
  link,
  notify,
  onSaved,
  onDeleted,
}: {
  link: Link;
  notify: (message: string) => void;
  onSaved: (link: Link) => void;
  onDeleted: () => void;
}) {
  const [visits, setVisits] = useState<Visits>();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void api
      .links({ id: link.id })
      .visits.get()
      .then(({ data }) =>
        data ? setVisits(data) : setError("Couldn’t load visits, close and reopen to retry"),
      );
  }, [link.id, link.visits]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { data, error } = await api
      .links({ id: link.id })
      .patch({ code: String(form.get("code")), url: String(form.get("url")) });
    if (error) return setError(String(error.value));
    setError(undefined);
    onSaved({ ...link, ...data });
    notify("Saved");
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    const { error } = await api.links({ id: link.id }).delete();
    if (error) return setError(String(error.value));
    onDeleted();
    notify(`Deleted /${link.code}`);
  }

  return (
    <div className="panel">
      <form className="edit" onSubmit={save} key={`${link.code} ${link.url}`}>
        <label className="input prefixed">
          <span>{location.host}/</span>
          <input
            name="code"
            defaultValue={link.code}
            aria-label="Code"
            pattern={CODE_PATTERN}
            required
            spellCheck={false}
          />
        </label>
        <input
          className="input"
          name="url"
          type="url"
          defaultValue={link.url}
          aria-label="Destination"
          required
        />
        <button className="button">Save</button>
      </form>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <a className="button ghost" href={link.url} target="_blank" rel="noreferrer">
          Open destination
        </a>
        <button className="button ghost danger" data-confirming={confirming} onClick={remove}>
          {confirming ? "Click again to delete" : "Delete"}
        </button>
      </div>

      {visits && <Activity visits={visits} />}
    </div>
  );
}

function Activity({ visits: { daily, recent } }: { visits: Visits }) {
  const counts = new Map(daily.map(({ day, count }) => [day, count]));
  const today = Math.floor(Date.now() / 86_400_000);
  const days = Array.from({ length: 30 }, (_, i) => today - 29 + i);
  const total = daily.reduce((sum, { count }) => sum + count, 0);
  const max = Math.max(1, ...counts.values());
  const summary = `${number(total)} ${total === 1 ? "visit" : "visits"} in the last 30 days`;

  return (
    <section className="activity">
      <p className="hint">{summary}</p>
      <div className="chart" role="img" aria-label={summary}>
        {days.map((day) => {
          const count = counts.get(day) ?? 0;
          // Days are counted in UTC by the server
          const date = new Date(day * 86_400_000).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          return (
            <span
              key={day}
              title={`${date}: ${count}`}
              data-empty={count === 0}
              style={{ height: `${(count / max) * 100}%` }}
            />
          );
        })}
      </div>
      {recent.length > 0 && (
        <ol className="visits">
          {recent.map((visit) => (
            <li key={visit.id}>
              <time
                dateTime={new Date(visit.createdAt * 1000).toISOString()}
                title={new Date(visit.createdAt * 1000).toLocaleString()}
              >
                {ago(visit.createdAt)}
              </time>
              <VisitDetails visit={visit} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function VisitDetails({ visit }: { visit: Visits["recent"][number] }) {
  const host = URL.parse(visit.referrer ?? "")?.host.replace(/^www\./, "");
  return (
    <span className="details">
      {visit.device && <span>{visit.device}</span>}
      {visit.country && (
        <span title={regions.of(visit.country)}>
          {flag(visit.country)} {visit.city ?? regions.of(visit.country)}
        </span>
      )}
      {visit.language && <span>{visit.language}</span>}
      {host && <span>via {host}</span>}
    </span>
  );
}

// Reuse the root across hot reloads in development
const root = (import.meta.hot.data.root ??= createRoot(document.getElementById("root")!));
root.render(<App />);
