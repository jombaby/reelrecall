"use client";

import { FormEvent, useState } from "react";

export default function SignIn() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (response.ok) location.href = "/";
    else { setError("That password is not correct."); setBusy(false); }
  }

  return <main className="sign-in"><section><a className="brand dark" href="/"><span>R</span><strong>ReelRecall</strong></a><p className="kicker">PRIVATE LIBRARY</p><h1>Welcome back.</h1><p>Your saved reels, categories, and archive are protected.</p><form onSubmit={submit}><label>Password<input type="password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></section></main>;
}
