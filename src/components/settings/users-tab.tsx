"use client";

import { useEffect, useState } from "react";

import { UserModal, type UserItem } from "@/components/settings/user-modal";
import { cn, formatDate } from "@/lib/utils";

export function UsersTab() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/users");
      const body = await response.json();
      setUsers(Array.isArray(body?.items) ? body.items : []);
    } catch {
      setUsers([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(user: UserItem) {
    setEditing(user);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  async function deleteUser(id: number, email: string | null) {
    if (!confirm(`Delete user ${email ?? id}?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to delete user.");
        return;
      }
      setUsers((prev) => prev.filter((user) => user.id !== id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
      ) : null}

      <section className="rounded-3xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Users</h3>
            <p className="mt-0.5 text-xs text-muted">
              {users.length} user{users.length === 1 ? "" : "s"} · passwords hashed with scrypt
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add user
          </button>
        </div>

        <ul className="divide-y divide-line/70">
          {users.map((user) => (
            <li
              key={`${user.id}-${user.email ?? "anon"}`}
              className="flex items-center justify-between gap-3 px-6 py-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold",
                    user.builtin ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                  )}
                >
                  {(user.name ?? user.email ?? "U").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink">
                      {user.name ?? user.email}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        user.role === "admin" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"
                      )}
                    >
                      {user.role}
                    </span>
                    {user.builtin ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        Built-in
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {user.email} · added {formatDate(user.createdAt)}
                  </p>
                  {user.builtin ? (
                    <p className="mt-0.5 text-[11px] text-muted">
                      Sourced from <code className="font-mono">ADMIN_USERNAME</code> /{" "}
                      <code className="font-mono">ADMIN_PASSWORD</code> env vars. Cannot be edited here.
                    </p>
                  ) : null}
                </div>
              </div>
              {user.builtin ? (
                <span className="text-[11px] text-muted">Managed via .env</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openEdit(user)}
                    disabled={busy}
                    className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteUser(user.id, user.email)}
                    disabled={busy}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <UserModal
        open={modalOpen}
        mode={editing ? "edit" : "create"}
        user={editing}
        onClose={closeModal}
        onSaved={load}
      />
    </div>
  );
}
