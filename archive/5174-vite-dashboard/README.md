# IntelliGuard Dashboard

Vite dashboard for IntelliGuard, an AI governance platform with control plane, agentic workflow, RBAC, LLM gateway, and audit evidence surfaces.

## Run Locally

```bash
npm install
npm run dev
```

The development server starts with Vite. Open the printed local URL in your browser.
By default the dashboard is served at:

```bash
http://localhost:5175/
```

For login and sign-up to work, run the FastAPI backend and optionally set:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## Build

```bash
npm run build
```

The Vite build outputs static assets to `dist` for deployment through the existing nginx container.
