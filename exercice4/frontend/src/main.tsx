import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./mc/visual.less";
import "./auth.css";
import { api, getToken, setToken, setUnauthorizedHandler, User } from "./api";
import { AuthPage } from "./AuthPage";
import { Dashboard } from "./Dashboard";

function Root(): React.ReactElement {
    const [user, setUser] = useState<User | null>(null);
    const [checking, setChecking] = useState<boolean>(!!getToken());

    const signOut = useCallback(async () => {
        try { await api("/auth/logout", { method: "POST" }); } catch { /* token already gone */ }
        setToken(null); setUser(null);
    }, []);

    useEffect(() => {
        setUnauthorizedHandler(() => setUser(null));
        if (!getToken()) { return; }
        api<{ user: User }>("/auth/me").then(r => setUser(r.user)).catch(() => setToken(null)).finally(() => setChecking(false));
    }, []);

    if (checking) { return <div className="auth-loading"><div className="auth-spinner" aria-label="Loading" /></div>; }
    if (!user) { return <AuthPage onSignedIn={(u, token) => { setToken(token); setUser(u); }} />; }
    return <Dashboard user={user} onSignOut={signOut} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(<Root />);
