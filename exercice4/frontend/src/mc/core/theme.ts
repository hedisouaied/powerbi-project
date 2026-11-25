"use strict";

/**
 * Design tokens. One source of truth: the same values feed CSS custom properties (set on the app root)
 * and the chart palettes, so switching theme / accent / density updates every component consistently.
 */

export type ThemeName = "dark" | "light";
export type AccentName = "gold" | "teal" | "blue" | "violet";
export interface Tokens { [k: string]: string }

const BASE: Record<ThemeName, Tokens> = {
    dark: {
        bg: "#06070A", bg2: "#0B0D12", panel: "#11151C", panel2: "#171C25", panel3: "#1F2530", line: "rgba(255,255,255,0.07)", line2: "rgba(255,255,255,0.12)",
        text: "#F4F6FA", soft: "#AEB6C3", muted: "#6E7787", good: "#34D399", warn: "#FBBF24", bad: "#F43F5E", info: "#38BDF8", teal: "#2DD4BF",
        shadow: "0 18px 40px rgba(0,0,0,0.55)", glass: "rgba(17,21,28,0.72)", grid: "rgba(255,255,255,0.05)"
    },
    light: {
        bg: "#F3F1EC", bg2: "#EAE7E0", panel: "#FFFFFF", panel2: "#F8F6F2", panel3: "#EFECE6", line: "rgba(20,24,32,0.09)", line2: "rgba(20,24,32,0.16)",
        text: "#151A23", soft: "#475061", muted: "#7B8494", good: "#059669", warn: "#B7791F", bad: "#DC2645", info: "#0284C7", teal: "#0F9F8F",
        shadow: "0 14px 30px rgba(31,36,48,0.12)", glass: "rgba(255,255,255,0.78)", grid: "rgba(20,24,32,0.06)"
    }
};
const ACCENTS: Record<AccentName, Record<ThemeName, [string, string]>> = {
    gold: { dark: ["#FFC53D", "#F59E0B"], light: ["#B7791F", "#D97706"] },
    teal: { dark: ["#2DD4BF", "#14B8A6"], light: ["#0F9F8F", "#0D9488"] },
    blue: { dark: ["#60A5FA", "#3B82F6"], light: ["#2563EB", "#1D4ED8"] },
    violet: { dark: ["#C084FC", "#A855F7"], light: ["#7C3AED", "#6D28D9"] }
};

export function tokens(theme: ThemeName, accent: AccentName): Tokens {
    const [a, a2] = ACCENTS[accent][theme];
    return { ...BASE[theme], accent: a, accent2: a2 };
}

/** Writes the tokens as --mc-* custom properties on the root element. */
export function applyTokens(el: HTMLElement, t: Tokens, density: "comfortable" | "compact", fontScale: number): void {
    Object.keys(t).forEach(k => el.style.setProperty(`--mc-${k}`, t[k]));
    el.style.setProperty("--mc-gap", density === "compact" ? "8px" : "12px");
    el.style.setProperty("--mc-pad", density === "compact" ? "10px" : "14px");
    el.style.setProperty("--mc-fs", `${13 * fontScale}px`);
}

/** Chart series palette derived from the accent (data colours stay distinct and readable in both themes). */
export function palette(t: Tokens): string[] {
    return [t.accent, t.teal, t.info, "#A78BFA", t.good, t.warn, t.bad, "#F472B6", "#94A3B8"];
}

export const SEVERITY_COLOR = (t: Tokens, s: string): string => ({ "Critique": t.bad, "Élevée": t.warn, "Avertissement": t.warn, "Moyenne": t.info, "Faible": t.muted, Info: t.muted } as Record<string, string>)[s] ?? t.muted;
export const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = {
    "Terminé": "good", "Résolu": "good", "Clôturé": "muted", "Approuvé": "good", "Mis en œuvre": "good", "Atteint": "good", "Payé": "good", "Actif": "good", Healthy: "good", "Examiné": "good", "Corrigé": "good", "Connecté (démo)": "good",
    "En cours": "info", "En traitement": "info", "En investigation": "info", "En mesure": "info", "En atténuation": "info", "Planifié": "info", "En bonne voie": "info", "En revue": "info", "Pris en compte": "info", "Reprogrammé": "info",
    "En attente": "warn", "Informations requises": "warn", "Proposé": "warn", "Non démarré": "muted", "À planifier": "muted", "À faire": "muted", "Nouveau": "warn", "Ouvert": "warn", Watch: "warn", "En attente de revue": "warn", "Partiel": "warn", "En pause": "warn", "Non examiné": "warn", "Accepté": "muted",
    "Bloqué": "bad", "À risque": "bad", "Annulé": "bad", "Rejeté": "bad", "En retard": "bad", "Critique": "bad", "Hors trajectoire": "bad", "Retourné": "bad", "Perdu": "bad", "Signalé": "bad", "Escaladé": "bad", "Remboursé": "muted"
};
