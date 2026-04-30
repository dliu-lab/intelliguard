# IntelliGuard Landing Page

Production-ready Next.js landing page for IntelliGuard, an AI governance platform with runtime control plane positioning.

## Run Locally

```bash
npm install
npm run dev
```

The development server starts with Next.js. Open the printed local URL in your browser.

For login and sign-up to work, run the FastAPI backend and optionally set:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Build

```bash
npm run build
```

The app uses a static export configuration for deployment through the existing nginx container.
