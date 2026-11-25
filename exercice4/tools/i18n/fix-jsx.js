// JSX text nodes (not string literals) and two small formatters that the dictionary pass cannot reach. Idempotent.
"use strict";
const fs = require("fs"), path = require("path");
const src = path.resolve(__dirname, "..", "..", "frontend", "src");
const NB = " ";
function patch(rel, pairs) {
    const p = path.join(src, rel); let s = fs.readFileSync(p, "utf8"); let n = 0;
    for (const [a, b] of pairs) { if (s.includes(b)) { continue; } if (!s.includes(a)) { throw new Error(`${rel}: not found: ${a.slice(0, 60)}`); } s = s.split(a).join(b); n++; }
    fs.writeFileSync(p, s); console.log(`${rel}: ${n}`);
}
patch("AuthPage.tsx", [
    ['<div className="auth-sub">Enterprise Intelligence Terminal</div>', '<div className="auth-sub">Terminal d\'intelligence d\'entreprise</div>'],
    ['setErrors({}); }}>Sign in</button>', 'setErrors({}); }}>Connexion</button>'],
    ['setErrors({}); }}>Create account</button>', 'setErrors({}); }}>Créer un compte</button>'],
    ['<p className="auth-hint">At least 8 characters, with letters and numbers.</p>', '<p className="auth-hint">Au moins 8 caractères, avec des lettres et des chiffres.</p>'],
    ['<p className="auth-foot">Synthetic demo data · amounts in TND</p>', '<p className="auth-foot">Données de démonstration synthétiques · montants en TND</p>']
]);
patch("Dashboard.tsx", [
    ["Could not load the data: {error}. Is the API running (php artisan serve)?", "Impossible de charger les données : {error}. L'API est-elle démarrée (php artisan serve) ?"]
]);
patch("mc/core/engine.ts", [
    ["`${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));", `\`\${(v / 1e6).toFixed(2).replace(".", ",")}${NB}M\` : Math.abs(v) >= 1e3 ? \`\${(v / 1e3).toFixed(1).replace(".", ",")}${NB}k\` : v.toFixed(0));`]
]);
patch("mc/modules/command.ts", [
    ["gauge(score, 100, `${score}%`,", `gauge(score, 100, \`\${score}${NB}%\`,`]
]);
