import React, { FormEvent, useState } from "react";
import { api, ApiError, User } from "./api";

/** The sign-in form starts filled with the public demo account; "Create account" starts empty. */
const DEMO_FORM = { name: "", email: "demo@missioncontrol.local", password: "Demo12345", password_confirmation: "" };
const EMPTY_FORM = { name: "", email: "", password: "", password_confirmation: "" };

/** Sign in / create account, in the Mission Control dark-gold design. */
export function AuthPage({ onSignedIn }: { onSignedIn: (user: User, token: string) => void }): React.ReactElement {
    const [mode, setMode] = useState<"login" | "register">("login");
    const [form, setForm] = useState(DEMO_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>): void => setForm({ ...form, [k]: e.target.value });

    async function submit(e: FormEvent): Promise<void> {
        e.preventDefault(); setBusy(true); setErrors({});
        try {
            const body = mode === "login" ? { email: form.email, password: form.password } : form;
            const r = await api<{ user: User; token: string }>(`/auth/${mode}`, { method: "POST", body });
            onSignedIn(r.user, r.token);
        } catch (err) {
            const ae = err as ApiError;
            const f: Record<string, string> = {}; Object.entries(ae.fields ?? {}).forEach(([k, v]) => { f[k] = v[0]; });
            if (!Object.keys(f).length) { f.form = ae.status === 429 ? "Too many attempts — wait a minute and try again." : ae.message; }
            setErrors(f);
        } finally { setBusy(false); }
    }

    const field = (k: keyof typeof form, label: string, type: string, auto: string): React.ReactElement => (
        <label className={`auth-field${errors[k] ? " auth-invalid" : ""}`}>
            <span>{label}</span>
            <input type={type} value={form[k]} onChange={set(k)} autoComplete={auto} required aria-invalid={!!errors[k]} />
            {errors[k] && <em role="alert">{errors[k]}</em>}
        </label>
    );

    return (
        <div className="auth-page">
            <div className="auth-glow" aria-hidden="true" />
            <main className="auth-card">
                <div className="auth-brand">
                    <svg viewBox="0 0 40 40" className="auth-logo" aria-hidden="true"><rect x="6" y="24" width="6" height="12" rx="1.5" /><rect x="15" y="16" width="6" height="20" rx="1.5" /><rect x="24" y="8" width="6" height="28" rx="1.5" /></svg>
                    <div><div className="auth-name">Mission Control</div><div className="auth-sub">Enterprise Intelligence Terminal</div></div>
                </div>
                <div className="auth-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setForm(DEMO_FORM); setErrors({}); }}>Sign in</button>
                    <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setForm(EMPTY_FORM); setErrors({}); }}>Create account</button>
                </div>
                <form onSubmit={submit} noValidate>
                    {mode === "register" && field("name", "Full name", "text", "name")}
                    {field("email", "Email", "email", "email")}
                    {field("password", "Password", "password", mode === "login" ? "current-password" : "new-password")}
                    {mode === "register" && field("password_confirmation", "Confirm password", "password", "new-password")}
                    {mode === "register" && <p className="auth-hint">At least 8 characters, with letters and numbers.</p>}
                    {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
                    <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
                </form>
                <p className="auth-foot">Synthetic demo data · amounts in TND</p>
            </main>
        </div>
    );
}
