---
name: components-2
description: "Skill for the Components area of intelliguard. 29 symbols across 8 files."
---

# Components

29 symbols | 8 files | Cohesion: 97%

## When to Use

- Working with code in `dashboard/`
- Understanding how MouseTrail, resize, loop work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | drawStar, drawOrb, MouseTrail, resize, loop (+3) |
| `dashboard/components/MouseTrail.tsx` | randomBetween, createParticle, onMove, drawStar, drawOrb (+3) |
| `dashboard/components/ThemeToggle.tsx` | applyTheme, readInitialTheme, ThemeToggle, toggleTheme |
| `dashboard/lib/api.ts` | login, register, saveSession |
| `dashboard/components/AuthModal.tsx` | handleSubmit, openAuthModal |
| `archive/5174-vite-dashboard/src/components/WorkflowTrace.jsx` | nodeLabel, WorkflowTrace |
| `dashboard/components/Navbar.tsx` | Navbar |
| `dashboard/components/Hero.tsx` | Hero |

## Entry Points

Start here when exploring this area:

- **`MouseTrail`** (Function) — `archive/5174-vite-dashboard/src/components/MouseTrail.jsx:93`
- **`resize`** (Function) — `archive/5174-vite-dashboard/src/components/MouseTrail.jsx:105`
- **`loop`** (Function) — `archive/5174-vite-dashboard/src/components/MouseTrail.jsx:132`
- **`login`** (Function) — `dashboard/lib/api.ts:143`
- **`register`** (Function) — `dashboard/lib/api.ts:150`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `MouseTrail` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 93 |
| `resize` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 105 |
| `loop` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 132 |
| `login` | Function | `dashboard/lib/api.ts` | 143 |
| `register` | Function | `dashboard/lib/api.ts` | 150 |
| `saveSession` | Function | `dashboard/lib/api.ts` | 586 |
| `handleSubmit` | Function | `dashboard/components/AuthModal.tsx` | 116 |
| `ThemeToggle` | Function | `dashboard/components/ThemeToggle.tsx` | 23 |
| `toggleTheme` | Function | `dashboard/components/ThemeToggle.tsx` | 39 |
| `Navbar` | Function | `dashboard/components/Navbar.tsx` | 9 |
| `Hero` | Function | `dashboard/components/Hero.tsx` | 39 |
| `openAuthModal` | Function | `dashboard/components/AuthModal.tsx` | 27 |
| `onMove` | Function | `dashboard/components/MouseTrail.tsx` | 148 |
| `loop` | Function | `dashboard/components/MouseTrail.tsx` | 164 |
| `onMove` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 112 |
| `MouseTrail` | Function | `dashboard/components/MouseTrail.tsx` | 112 |
| `resize` | Function | `dashboard/components/MouseTrail.tsx` | 139 |
| `WorkflowTrace` | Function | `archive/5174-vite-dashboard/src/components/WorkflowTrace.jsx` | 28 |
| `drawStar` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 51 |
| `drawOrb` | Function | `archive/5174-vite-dashboard/src/components/MouseTrail.jsx` | 66 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleSubmit → Request` | cross_community | 3 |
| `OnMove → RandomBetween` | intra_community | 3 |
| `OnMove → RandomBetween` | intra_community | 3 |
| `MouseTrail → DrawStar` | intra_community | 3 |
| `MouseTrail → DrawOrb` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| _components | 2 calls |

## How to Explore

1. `gitnexus_context({name: "MouseTrail"})` — see callers and callees
2. `gitnexus_query({query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
