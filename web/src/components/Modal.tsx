import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "./Icons.tsx";

export function Modal({ title, onClose, children, tone = "neutral" }: { title: string; onClose: () => void; children: ReactNode; tone?: "neutral" | "danger" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(640px,92vw)] rounded-2xl bg-transparent p-0 text-inherit backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className={`rounded-2xl border bg-stone-50 p-6 shadow-2xl dark:bg-[#15161a] ${tone === "danger" ? "border-signal/50" : "border-stone-300 dark:border-stone-800"}`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className={`font-mono text-xs uppercase tracking-[0.25em] ${tone === "danger" ? "text-signal" : "text-stone-500"}`}>{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800" aria-label="Close">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
