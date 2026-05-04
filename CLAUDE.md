<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **intelliguard** (3478 symbols, 6385 relationships, 254 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/intelliguard/context` | Codebase overview, check index freshness |
| `gitnexus://repo/intelliguard/clusters` | All functional areas |
| `gitnexus://repo/intelliguard/processes` | All execution flows |
| `gitnexus://repo/intelliguard/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the _components area (246 symbols) | `.claude/skills/generated/components/SKILL.md` |
| Work in the Agent_governance area (126 symbols) | `.claude/skills/generated/agent-governance/SKILL.md` |
| Work in the Evaluation area (76 symbols) | `.claude/skills/generated/evaluation/SKILL.md` |
| Work in the Api area (31 symbols) | `.claude/skills/generated/api/SKILL.md` |
| Work in the Components area (29 symbols) | `.claude/skills/generated/components-2/SKILL.md` |
| Work in the Tests area (24 symbols) | `.claude/skills/generated/tests/SKILL.md` |
| Work in the Marketplace area (17 symbols) | `.claude/skills/generated/marketplace/SKILL.md` |
| Work in the Examples area (9 symbols) | `.claude/skills/generated/examples/SKILL.md` |
| Work in the Cluster_80 area (6 symbols) | `.claude/skills/generated/cluster-80/SKILL.md` |
| Work in the Cluster_79 area (5 symbols) | `.claude/skills/generated/cluster-79/SKILL.md` |

<!-- gitnexus:end -->
