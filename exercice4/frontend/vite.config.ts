import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: http://localhost:5173 with /api proxied to Laravel (php artisan serve on :8000).
// Build: the app is written to backend/public/app and served by Laravel at http://localhost:8000.
export default defineConfig({
    plugins: [react()],
    base: "/app/",
    server: { port: 5173, proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } } },
    build: { outDir: "../backend/public/app", emptyOutDir: true, chunkSizeWarningLimit: 1500 }
});
