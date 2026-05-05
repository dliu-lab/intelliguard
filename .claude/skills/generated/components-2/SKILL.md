---
name: components-2
description: "Skill for the Components area of intelliguard. 19 symbols across 6 files."
---

# Components

19 symbols | 6 files | Cohesion: 95%

## When to Use

- Working with code in `dashboard/`
- Understanding how login, register, saveSession work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `dashboard/components/MouseTrail.tsx` | randomBetween, createParticle, onMove, drawStar, drawOrb (+3) |
| `dashboard/components/ThemeToggle.tsx` | applyTheme, readInitialTheme, ThemeToggle, toggleTheme |
| `dashboard/lib/api.ts` | login, register, saveSession |
| `dashboard/components/AuthModal.tsx` | handleSubmit, openAuthModal |
| `dashboard/components/Navbar.tsx` | Navbar |
| `dashboard/components/Hero.tsx` | Hero |

## Entry Points

Start here when exploring this area:

- **`login`** (Function) — `dashboard/lib/api.ts:201`
- **`register`** (Function) — `dashboard/lib/api.ts:208`
- **`saveSession`** (Function) — `dashboard/lib/api.ts:732`
- **`handleSubmit`** (Function) — `dashboard/components/AuthModal.tsx:116`
- **`ThemeToggle`** (Function) — `dashboard/components/ThemeToggle.tsx:23`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `login` | Function | `dashboard/lib/api.ts` | 201 |
| `register` | Function | `dashboard/lib/api.ts` | 208 |
| `saveSession` | Function | `dashboard/lib/api.ts` | 732 |
| `handleSubmit` | Function | `dashboard/components/AuthModal.tsx` | 116 |
| `ThemeToggle` | Function | `dashboard/components/ThemeToggle.tsx` | 23 |
| `toggleTheme` | Function | `dashboard/components/ThemeToggle.tsx` | 39 |
| `Navbar` | Function | `dashboard/components/Navbar.tsx` | 9 |
| `Hero` | Function | `dashboard/components/Hero.tsx` | 39 |
| `openAuthModal` | Function | `dashboard/components/AuthModal.tsx` | 27 |
| `onMove` | Function | `dashboard/components/MouseTrail.tsx` | 148 |
| `loop` | Function | `dashboard/components/MouseTrail.tsx` | 164 |
| `MouseTrail` | Function | `dashboard/components/MouseTrail.tsx` | 112 |
| `resize` | Function | `dashboard/components/MouseTrail.tsx` | 139 |
| `applyTheme` | Function | `dashboard/components/ThemeToggle.tsx` | 9 |
| `readInitialTheme` | Function | `dashboard/components/ThemeToggle.tsx` | 13 |
| `randomBetween` | Function | `dashboard/components/MouseTrail.tsx` | 34 |
| `createParticle` | Function | `dashboard/components/MouseTrail.tsx` | 38 |
| `drawStar` | Function | `dashboard/components/MouseTrail.tsx` | 61 |
| `drawOrb` | Function | `dashboard/components/MouseTrail.tsx` | 82 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleSubmit → Request` | cross_community | 3 |
| `OnMove → RandomBetween` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| _components | 2 calls |

## How to Explore

1. `gitnexus_context({name: "login"})` — see callers and callees
2. `gitnexus_query({query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
