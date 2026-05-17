import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim()) {
      setError("All fields are required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-md border px-3 py-2.5 text-sm text-white placeholder:text-white/60 outline-none transition-colors focus:border-[var(--color-accent)]";
  const inputStyle = {
    background: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.35)",
  };

  if (submitted) {
    return (
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-extrabold text-white">
          You&apos;re on the list.
        </h2>
        <p className="text-sm" style={{ color: "#bdbdc6" }}>
          We&apos;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-3">
      <div>
        <h2 className="mb-1.5 text-2xl font-extrabold text-white">
          Be first in line.
        </h2>
        <p className="mb-2 text-sm" style={{ color: "#e2e2ea" }}>
          Join the Invo.ai waitlist and get early access when we launch.
        </p>
      </div>
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={inputCls}
        style={inputStyle}
        placeholder="Company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
      />
      {error && (
        <p className="text-xs" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="pressable focus-ring rounded-md px-6 py-3 text-sm font-bold text-white transition-colors disabled:opacity-60"
        style={{ background: "var(--color-accent)" }}
      >
        {loading ? "Submitting…" : "Join waitlist"}
      </button>
    </form>
  );
}
