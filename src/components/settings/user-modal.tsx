"use client";

import { useEffect, useState } from "react";

export type UserItem = {
  id: number;
  name: string | null;
  email: string | null;
  role: string;
  builtin?: boolean;
  createdAt: string;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  user?: UserItem | null;
  onClose: () => void;
  onSaved: () => void;
};

const ROLES = ["admin", "manager", "editor", "viewer"] as const;

export function UserModal({ open, mode, user, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (mode === "edit" && user) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
      setRole(user.role);
      setPassword("");
    } else if (mode === "create") {
      setName("");
      setEmail("");
      setPassword("");
      setRole("viewer");
    }
    setError("");
    setShowPassword(false);
  }, [mode, user, open]);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const payload: Record<string, string> = { name, email, role };
    if (password) payload.password = password;

    const url = mode === "edit" && user ? `/api/users/${user.id}` : "/api/users";
    const method = mode === "edit" ? "PATCH" : "POST";

    if (mode === "create" && !password) {
      setError("Password is required for new users.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Save failed.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-white shadow-panel"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
              {mode === "edit" ? "Edit user" : "New user"}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-ink">
              {mode === "edit" ? user?.name ?? user?.email ?? "User" : "Create dashboard user"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <Field label="Full name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              placeholder="jane@example.com"
            />
          </Field>
          <Field
            label={mode === "edit" ? "New password" : "Password"}
            required={mode === "create"}
            hint={mode === "edit" ? "Leave blank to keep current password" : "Min 8 characters"}
          >
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "create" ? 8 : undefined}
                required={mode === "create"}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 pr-14 text-sm outline-none focus:border-brand focus:bg-white"
                placeholder={mode === "edit" ? "Unchanged" : "••••••••"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:bg-canvas"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
            >
              {ROLES.map((roleOption) => (
                <option key={roleOption} value={roleOption}>
                  {roleOption}
                </option>
              ))}
            </select>
          </Field>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving..." : mode === "edit" ? "Save changes" : "Create user"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          {label}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </span>
        {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}
