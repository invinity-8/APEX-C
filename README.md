# APEX-C

APEX – interaktive D&D-Hex-Arena (React, TypeScript, Vite).

## Deployment auf Vercel

1. Die Dateien `package.json`, `package-lock.json`, `index.html`, `src/`, `public/`, `vite.config.ts` und `vercel.json` müssen direkt im Repository liegen, nicht in einem zusätzlichen übergeordneten Unterordner.
2. Vercel-Einstellungen: Framework **Vite**, Install Command `npm ci`, Build Command `npm run build`, Output Directory `dist`.
3. Änderungen auf dem Branch `main` starten automatisch ein neues Vercel-Deployment, sofern das Projekt verbunden ist.

**Status:** Dieses README allein stellt noch keine fertige Web-App dar. Die eigentlichen Projektdateien müssen hinzugefügt werden.

Die erste Version ist ein Demo-Harness mit lokalem Spielstand und noch kein sicher synchronisierter Multiplayer-Modus.
