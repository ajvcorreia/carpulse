"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  backupNowAction,
  runScanNowAction,
  saveEmailSettingsAction,
  savePhotoSettingsAction,
  saveScanSettingsAction,
  sendTestEmailAction,
  stopScanAction,
} from "@/lib/settings-actions";
import type { BackupFile } from "@/lib/backup";
import type { ScanRunRow, ScanSummary } from "@/lib/scan";
import type { EmailSettings, PhotoSettings, ScanSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1";
const buttonClass =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary disabled:opacity-60";
const primaryButtonClass = "rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

function ResultLine({ result }: { result: Result }) {
  if (!result) return null;
  if (!result.ok) return <p className="text-sm text-critical">{result.error}</p>;
  return result.message ? <p className="text-sm text-text-secondary">{result.message}</p> : null;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-text-secondary">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

function timezones(current: string) {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    // very old runtime — just offer the saved one
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

export function PhotoSettingsForm({ settings }: { settings: PhotoSettings }) {
  const [result, action, pending] = useActionState(savePhotoSettingsAction, null);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border p-4">
      <Checkbox name="enabled" label="Save listing photos" defaultChecked={settings.enabled} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}

// A default for a newly added start time: six hours after the last one.
function nextStartTime(times: string[]) {
  const [h, m] = (times.at(-1) ?? "00:00").split(":").map(Number);
  return `${String((h + 6) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Rough length of a full scan with the saved pauses, so start times can be
// spaced out — loading each page adds a few seconds per car on top.
function scanDurationHint(carCount: number, s: ScanSettings) {
  const minutes = (seconds: number) => Math.max(1, Math.round((carCount * seconds) / 60));
  const span = (n: number) => (n >= 90 ? `${Math.round((n / 60) * 10) / 10} h` : `${n} min`);
  return `A full scan of ${carCount} cars takes about ${span(minutes(s.minPauseSeconds + 5))}–${span(
    minutes(s.maxPauseSeconds + 5)
  )} with the saved pauses. A start time reached while a scan is still running is skipped.`;
}

export function ScanSettingsForm({
  settings,
  lastScheduledSlot,
  carCount,
}: {
  settings: ScanSettings;
  lastScheduledSlot: string | null;
  carCount: number;
}) {
  const [result, action, pending] = useActionState(saveScanSettingsAction, null);
  const [frequency, setFrequency] = useState(settings.frequency);
  const [times, setTimes] = useState(settings.times);

  return (
    <form action={action} className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Checkbox name="enabled" label="Scan automatically" defaultChecked={settings.enabled} />
      </div>
      <Field id="frequency" label="Repeat">
        <select
          id="frequency"
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ScanSettings["frequency"])}
          className={inputClass}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </Field>
      {frequency === "weekly" ? (
        <Field id="weekday" label="On">
          <select id="weekday" name="weekday" defaultValue={settings.weekday} className={inputClass}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="weekday" value={settings.weekday} />
      )}
      <Field
        id="time-0"
        label={
          times.length > 1
            ? `Start times (${times.length} scans a ${frequency === "weekly" ? "week" : "day"})`
            : "Start time"
        }
        hint={scanDurationHint(carCount, settings)}
      >
        <div className="space-y-2">
          {times.map((t, i) => (
            <div key={i} className="flex gap-2">
              <input
                id={`time-${i}`}
                name="time"
                type="time"
                required
                value={t}
                onChange={(e) => setTimes((ts) => ts.map((x, j) => (j === i ? e.target.value : x)))}
                className={inputClass}
              />
              {times.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setTimes((ts) => ts.filter((_, j) => j !== i))}
                  aria-label={`Remove start time ${t}`}
                  className={buttonClass}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {times.length < 24 ? (
            <button type="button" onClick={() => setTimes((ts) => [...ts, nextStartTime(ts)])} className={buttonClass}>
              + Add start time
            </button>
          ) : null}
        </div>
      </Field>
      <Field id="timezone" label="Timezone">
        <select id="timezone" name="timezone" defaultValue={settings.timezone} className={inputClass}>
          {timezones(settings.timezone).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </Field>
      <Field id="minPauseSeconds" label="Pause between cars — min (seconds)">
        <input
          id="minPauseSeconds"
          name="minPauseSeconds"
          type="number"
          min={0}
          max={600}
          defaultValue={settings.minPauseSeconds}
          className={inputClass}
        />
      </Field>
      <Field id="maxPauseSeconds" label="Pause between cars — max (seconds)">
        <input
          id="maxPauseSeconds"
          name="maxPauseSeconds"
          type="number"
          min={0}
          max={600}
          defaultValue={settings.maxPauseSeconds}
          className={inputClass}
        />
      </Field>
      <div className="space-y-2 sm:col-span-2">
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Saving…" : "Save schedule"}
          </button>
          <ResultLine result={result} />
        </div>
        {lastScheduledSlot ? (
          <p className="text-xs text-text-muted">
            Last scheduled slot: {lastScheduledSlot}. A run missed while the app was down still starts once it&apos;s
            back (several missed ones count as one).
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function EmailSettingsForm({
  settings,
  hasPassword,
}: {
  settings: Omit<EmailSettings, "smtpPassword">;
  hasPassword: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, action, pending] = useActionState(saveEmailSettingsAction, null);
  const [testResult, setTestResult] = useState<Result>(null);
  const [testing, startTesting] = useTransition();

  function sendTest() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    setTestResult(null);
    startTesting(async () => setTestResult(await sendTestEmailAction(formData)));
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
    >
      <div className="space-y-2 sm:col-span-2">
        <Checkbox name="enabled" label="Email a summary after each scan" defaultChecked={settings.enabled} />
        <Checkbox name="onlyWhenChanged" label="Only when something changed" defaultChecked={settings.onlyWhenChanged} />
      </div>
      <Field id="to" label="Send to">
        <input
          id="to"
          name="to"
          type="email"
          defaultValue={settings.to}
          className={inputClass}
          placeholder="you@example.com"
        />
      </Field>
      <Field id="from" label="From" hint="Defaults to the SMTP username.">
        <input
          id="from"
          name="from"
          defaultValue={settings.from}
          className={inputClass}
          placeholder="CarPulse <carpulse@example.com>"
        />
      </Field>
      <Field id="smtpHost" label="SMTP host">
        <input
          id="smtpHost"
          name="smtpHost"
          defaultValue={settings.smtpHost}
          className={inputClass}
          placeholder="smtp.gmail.com"
        />
      </Field>
      <Field id="smtpPort" label="SMTP port">
        <input
          id="smtpPort"
          name="smtpPort"
          type="number"
          min={1}
          max={65535}
          defaultValue={settings.smtpPort}
          className={inputClass}
        />
      </Field>
      <Field id="smtpUser" label="SMTP username">
        <input id="smtpUser" name="smtpUser" defaultValue={settings.smtpUser} autoComplete="off" className={inputClass} />
      </Field>
      <Field id="smtpPassword" label="SMTP password" hint={hasPassword ? "Saved — leave blank to keep it." : undefined}>
        <input
          id="smtpPassword"
          name="smtpPassword"
          type="password"
          autoComplete="new-password"
          placeholder={hasPassword ? "••••••••" : ""}
          className={inputClass}
        />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          name="smtpSecure"
          label="Use TLS from the start (port 465) — leave off for STARTTLS on 587"
          defaultChecked={settings.smtpSecure}
        />
      </div>
      <Field id="appUrl" label="App URL (optional)" hint="Links in the email point here, e.g. https://carpulse.example.com">
        <input id="appUrl" name="appUrl" type="url" defaultValue={settings.appUrl} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Save email settings"}
        </button>
        <button type="button" onClick={sendTest} disabled={testing} className={buttonClass}>
          {testing ? "Sending…" : "Send test email"}
        </button>
        <ResultLine result={result} />
        <ResultLine result={testResult} />
      </div>
    </form>
  );
}

const STATUS_LABELS: Record<ScanRunRow["status"], string> = {
  running: "Running",
  done: "Finished",
  cancelled: "Stopped",
  failed: "Failed",
  interrupted: "Interrupted (app restarted)",
};

function formatWhen(iso: string, timezone: string) {
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// Opens the car's expanded card on the dashboard (same "?highlight=" link
// the scan email uses), not the listing site.
const carHref = (id: string) => `/?highlight=${encodeURIComponent(id)}`;

function RunDetails({ summary }: { summary: ScanSummary }) {
  const groups: { title: string; items: { key: string; text: string; href: string | null }[] }[] = [
    {
      title: "Price changes",
      items: summary.priceChanges.map((c) => ({
        key: c.id,
        href: carHref(c.id),
        text: `${c.label}: ${c.previous != null ? `${formatPrice(c.previous, c.currency)} → ` : ""}${formatPrice(c.price, c.currency)}`,
      })),
    },
    {
      title: "Back on sale",
      items: summary.reactivated.map((c) => ({ key: c.id, href: carHref(c.id), text: c.label })),
    },
    {
      title: "Marked removed",
      items: summary.removed.map((c) => ({ key: c.id, href: carHref(c.id), text: c.label })),
    },
    {
      title: "Couldn't check",
      items: summary.problems.map((p, i) => ({
        key: `${p.id}-${i}`,
        href: p.id ? carHref(p.id) : null,
        text: `${p.label}: ${p.message}`,
      })),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-2 pt-2">
      {groups.length === 0 ? <p className="text-sm text-text-secondary">No changes.</p> : null}
      {groups.map((g) => (
        <div key={g.title}>
          <p className="text-xs font-medium text-text-secondary">{g.title}</p>
          <ul className="list-disc pl-5 text-sm">
            {g.items.map((item) => (
              <li key={item.key}>
                {item.href ? (
                  <Link href={item.href} className="hover:underline">
                    {item.text}
                  </Link>
                ) : (
                  item.text
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {summary.emailSent ? <p className="text-xs text-text-muted">Summary emailed.</p> : null}
      {summary.emailError ? <p className="text-xs text-critical">Email failed: {summary.emailError}</p> : null}
    </div>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupsPanel({ backups, timezone }: { backups: BackupFile[]; timezone: string }) {
  const router = useRouter();
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  function backUpNow() {
    setResult(null);
    startTransition(async () => {
      setResult(await backupNowAction());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      {backups.length === 0 ? (
        <p className="text-sm text-text-secondary">No backups yet — the first is made within a minute of starting.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {backups.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-x-3">
              <a href={`/backups/${b.name}`} className="hover:underline">
                {b.name}
              </a>
              <span className="text-xs text-text-muted">
                {formatSize(b.size)} · saved {formatWhen(b.created_at, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={backUpNow} disabled={pending} className={buttonClass}>
          {pending ? "Backing up…" : "Back up now"}
        </button>
        <ResultLine result={result} />
      </div>
    </div>
  );
}

export function ScanRunsPanel({ runs, running, timezone }: { runs: ScanRunRow[]; running: boolean; timezone: string }) {
  const router = useRouter();
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  // Live progress while a scan runs — the page is server-rendered, so just
  // re-fetch it every few seconds until the run finishes.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [running, router]);

  function run(action: () => Promise<Result>) {
    setResult(null);
    startTransition(async () => {
      setResult(await action());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <>
            <Link href="/scan" className={primaryButtonClass}>
              Watch live
            </Link>
            <button type="button" onClick={() => run(stopScanAction)} disabled={pending} className={buttonClass}>
              Stop scan
            </button>
          </>
        ) : (
          <button type="button" onClick={() => run(runScanNowAction)} disabled={pending} className={primaryButtonClass}>
            Run scan now
          </button>
        )}
        <ResultLine result={result} />
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-text-secondary">No scans yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => {
            const summary: ScanSummary | null = r.summary ? JSON.parse(r.summary) : null;
            const counts = summary
              ? `${summary.priceChanges.length} price changes · ${summary.reactivated.length} back on sale · ${summary.removed.length} removed · ${summary.problems.length} couldn't check`
              : "";
            return (
              <li key={r.id} className="py-2">
                <details open={r.status === "running"}>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{formatWhen(r.started_at, timezone)}</span>{" "}
                    <span className="text-text-secondary">
                      · {r.trigger === "schedule" ? "scheduled" : "manual"} · {STATUS_LABELS[r.status]} · {r.checked}/
                      {r.total} checked
                    </span>
                    {counts ? <span className="block text-xs text-text-muted">{counts}</span> : null}
                  </summary>
                  {summary ? <RunDetails summary={summary} /> : null}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
