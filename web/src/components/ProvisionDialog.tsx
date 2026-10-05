import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { Btn, Label } from "./ui.tsx";
import { Modal } from "./Modal.tsx";
import type { ProvisionResult, Sandbox, SandboxCourse } from "../types.ts";

const field = "mt-1.5 w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-signal dark:border-stone-700 dark:bg-[#15161a]";

/** The courses the server offers (their default lifetime and what they grant). */
function useCourses() {
  const [courses, setCourses] = useState<SandboxCourse[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<SandboxCourse[]>("/api/sandboxes/courses").then(setCourses).catch((e: Error) => setError(e.message));
  }, []);
  return { courses, error };
}

/**
 * What an admin sends the student after a sandbox is created or created again. The message is the deliverable: it is in Spanish
 * (the guides are Spanish) and has a Copy button.
 */
function ResultDialog({ result, onClose }: { result: ProvisionResult; onClose: () => void }) {
  const { notify } = useStore();
  const r = result.record;
  return (
    <Modal title="Sandbox created" onClose={onClose}>
      <div className="text-xl font-semibold">{r.student_name}</div>
      <div className="mt-1 font-mono text-xs text-stone-500">
        {r.rg_name} · ends {r.expires_on.slice(0, 10)}
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <Label>Message for the student (Spanish)</Label>
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(result.note)
              .then(() => notify("Message copied"))
              .catch(() => notify("Could not copy. Select the message and copy it by hand.", "bad"))
          }
          className="text-xs text-stone-500 transition hover:text-signal"
        >
          Copy
        </button>
      </div>
      <pre className="mt-1.5 max-h-64 overflow-auto rounded-xl bg-stone-200/50 p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap dark:bg-stone-900" tabIndex={0} aria-label="Message for the student">
        {result.note}
      </pre>

      {result.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl bg-amber-300/15 px-3 py-2 text-xs">
          {result.warnings.map((w) => (
            <li key={w}>! {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex justify-end">
        <Btn tone="solid" onClick={onClose}>
          Done
        </Btn>
      </div>
    </Modal>
  );
}

/** Creates a student sandbox, then shows the message to send the student. */
export function ProvisionDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { courses, error: coursesError } = useCourses();
  const [student, setStudent] = useState("");
  const [course, setCourse] = useState("");
  const [days, setDays] = useState<number>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ProvisionResult>();
  const emailRef = useRef<HTMLInputElement>(null);

  // The modal takes focus when it opens (after this field's own autofocus), so focus the email field once it is open.
  useEffect(() => emailRef.current?.focus(), []);

  useEffect(() => {
    if (courses?.[0]) {
      setCourse(courses[0].id);
      setDays(courses[0].ttlDays);
    }
  }, [courses]);

  const chosen = courses?.find((c) => c.id === course);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api<ProvisionResult>("/api/sandboxes", { method: "POST", body: { student: student.trim(), course, days } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (result) onDone();
    onClose();
  };

  if (result) return <ResultDialog result={result} onClose={finish} />;

  return (
    <Modal title="New student sandbox" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="block">
          <Label>Student's email</Label>
          <input ref={emailRef} type="email" required value={student} onChange={(e) => setStudent(e.target.value)} placeholder="name@example.com" autoComplete="off" className={field} />
          <span className="mt-1 block text-xs text-stone-500">Must be a member or an invited guest of the business tenant.</span>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {courses && courses.length > 1 && (
            <label className="block">
              <Label>Course</Label>
              <select
                value={course}
                onChange={(e) => {
                  setCourse(e.target.value);
                  const c = courses.find((x) => x.id === e.target.value);
                  if (c) setDays(c.ttlDays);
                }}
                className={field}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <Label>Lifetime (days)</Label>
            <input type="number" min={1} max={90} required value={days} onChange={(e) => setDays(Number(e.target.value))} className={field} />
          </label>
        </div>

        {chosen && (
          <p className="mt-4 text-xs text-stone-500">
            {chosen.title}: a resource group of their own with Contributor and lock rights on it only, regions limited to {chosen.allowedLocations.length} US regions, a ${chosen.budgetUsd} monthly budget alert, and automatic deletion on the end date.
          </p>
        )}

        {(error ?? coursesError) && (
          <p role="alert" className="mt-4 rounded-xl bg-signal/10 p-3 text-xs text-signal">
            {error ?? coursesError}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Btn type="button" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" tone="solid" disabled={busy || !courses || !student.trim() || days < 1 || days > 90}>
            {busy ? "Creating…" : "Create sandbox"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/** Creates the sandbox again for a student whose group is gone: same group name and student, a new end date. */
export function ReprovisionDialog({ sandbox, onClose, onDone }: { sandbox: Sandbox; onClose: () => void; onDone: () => void }) {
  const { courses } = useCourses();
  const [days, setDays] = useState<number>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ProvisionResult>();

  useEffect(() => {
    const c = courses?.find((x) => x.id === sandbox.course);
    if (c) setDays(c.ttlDays);
  }, [courses, sandbox.course]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api<ProvisionResult>(`/api/sandboxes/${encodeURIComponent(sandbox.rg_name)}/reprovision`, { method: "POST", body: { days } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (result) onDone();
    onClose();
  };

  if (result) return <ResultDialog result={result} onClose={finish} />;

  return (
    <Modal title="Create sandbox again" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="text-xl font-semibold">{sandbox.student_name}</div>
        <div className="mt-1 font-mono text-xs text-stone-500">{sandbox.rg_name}</div>
        <p className="mt-4 text-sm text-stone-500">The group is gone (the student deleted it, it expired, or it was deleted here). This creates it again with the same name and the same rules, and nothing the student built before comes back.</p>
        <label className="mt-4 block">
          <Label>Lifetime (days)</Label>
          <input type="number" min={1} max={90} required value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${field} sm:w-40`} />
        </label>
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-signal/10 p-3 text-xs text-signal">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Btn type="button" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" tone="solid" disabled={busy || days < 1 || days > 90}>
            {busy ? "Creating…" : "Create again"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
