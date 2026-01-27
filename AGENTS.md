# AGENTS.md

## Core Philosophy

**TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE.** Every single line of production code must be written in response to a failing test. No exceptions. This is not a suggestion or a preference - it is the fundamental practice that enables all other principles in this document.

I follow Test-Driven Development (TDD) with a strong emphasis on behavior-driven testing and functional programming principles. All work should be done in small, incremental changes that maintain a working state throughout development.

## Quick Reference

**Key Principles:**

- Write tests first (TDD)
- Test behavior, not implementation
- No `any` types or type assertions
- Immutable data only
- Small, pure functions
- TypeScript strict mode always
- Use real schemas/types in tests, never redefine them

**Preferred Tools:**

- **Language**: TypeScript (strict mode)
- **Testing**: Jest/Vitest + React Testing Library
- **State Management**: Prefer immutable patterns

## Testing Principles

**Core principle**: Test behavior, not implementation. 100% coverage through business behavior.

**Quick reference:**
- Write tests first (TDD non-negotiable)
- Test through public API exclusively
- Use factory functions for test data (no `let`/`beforeEach`)
- Tests must document expected business behavior
- No 1:1 mapping between test files and implementation files

For detailed testing patterns and examples, load the `testing` skill.
For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill.

## TypeScript Guidelines

**Core principle**: Strict mode always. Schema-first at trust boundaries, types for internal logic.

**Quick reference:**
- No `any` types - ever (use `unknown` if type truly unknown)
- No type assertions without justification
- Prefer `type` over `interface` for data structures
- Reserve `interface` for behavior contracts only
- Define schemas first, derive types from them (Zod/Standard Schema)
- Use schemas at trust boundaries, plain types for internal logic

For detailed TypeScript patterns and rationale, load the `typescript-strict` skill.

## Code Style

**Core principle**: Functional programming with immutable data. Self-documenting code.

**Quick reference:**
- No data mutation - immutable data structures only
- Pure functions wherever possible
- No nested if/else - use early returns or composition
- No comments - code should be self-documenting
- Prefer options objects over positional parameters
- Use array methods (`map`, `filter`, `reduce`) over loops

For detailed patterns and examples, load the `functional` skill.

## Default workflow (when applicable)

**Core principle**: RED-GREEN-REFACTOR in small, known-good increments. TDD is the fundamental practice.

**Quick reference:**
- RED: Write failing test first (NO production code without failing test)
- GREEN: Write MINIMUM code to pass test
- REFACTOR: Assess improvement opportunities (only refactor if adds value)
- **Wait for commit approval** before every commit
- Each increment leaves codebase in working state
- Capture learnings as they occur, merge at end

For detailed TDD workflow, load the `tdd` skill.
For refactoring methodology, load the `refactoring` skill.
For significant work, load the `planning` skill for three-document model (PLAN.md, WIP.md, LEARNINGS.md).

- If the task is ambiguous or large, use `planning` (or `planner`/`architect`) to propose a minimal plan, a test strategy, and explicit verification steps before editing.
- Implement via strict TDD: use `tdd` + `testing` (RED → GREEN → REFACTOR). Never write production code without a failing test.
- Keep changes small and reversible. For refactors: run `refactor-scan` first; refactor only when tests are green; finish with `refactor-cleaner`.
- Verify your work: run the smallest relevant checks (tests/lint/typecheck/build, as applicable) and report what you ran + the result. If you can't run them, say why.
- Before finishing: run `code-reviewer` and incorporate findings. Run `security-reviewer` for auth/input/secrets/network changes; run `docs-guardian`/`doc-updater` when docs should change; run `ts-enforcer` in TypeScript repos.

## Skills (when available)

- Planning and task sizing: `planning`
- Definition of done / communication: `expectations`
- TDD workflow + test patterns: `tdd`, `testing` (and `mutation-testing` when useful)
- Refactors: `refactor-scan`, `refactoring`, `refactor-cleaner`
- Code style / immutability: `functional`
- TypeScript strictness (TypeScript repos): `typescript-strict`, `ts-enforcer`
- Security, reviews, and docs: `security-review`, `security-reviewer`, `code-reviewer`, `docs-guardian`, `doc-updater`
- UI and E2E verification: `dev-browser`, `e2e-runner`, `front-end-testing`, `react-testing`
- Architecture decisions: `architect`, `adr`
- Build failures: `build-error-resolver`

## Non-negotiables

- TDD is non-negotiable: never write production code except in response to a failing test (RED → GREEN → REFACTOR). Use `tdd` + `testing`.
- Verify your work: run the smallest relevant checks (tests/lint/typecheck/build, as applicable) and report what you ran + the result. If you can't run them, say why.
- Keep changes small and reversible: minimal diffs, no drive-by refactors. If the change is large, use `planning` to propose a short plan before editing.

## Code organization

- Follow existing project conventions and structure; do not reorganize large areas without asking first.
- Prefer small, cohesive modules; if a file is growing unwieldy, propose a split as a focused follow-up.

## Testing

- Prefer behavior-first tests through public APIs; avoid implementation-detail tests (see `testing`).
- When a bug is reported, start with a failing regression test, then implement the smallest fix to pass (see `tdd`).

## TypeScript (if applicable)

- Stay strict: avoid `any` and unjustified type assertions; prefer schema-first validation at trust boundaries (see `typescript-strict`).

## Security

- Never hardcode secrets; avoid logging sensitive data; validate untrusted inputs at trust boundaries (see `security-review` and use `security-reviewer` when relevant).

## Safety and hygiene

- Ask before making high-impact changes (new dependencies, migrations, auth/security-sensitive behavior, large refactors). Use `planning` to propose options and tradeoffs first.
- Ask before deleting files or doing large renames/moves.
- Prefer deterministic, inspectable automation (formatters, linters, scripts) over clever code.

## Optional tooling

- If MCP tools are available in this environment, use them when they reduce guesswork (for example: docs lookups, diagrams, GitHub context). Fall back gracefully when unavailable.

## Working with Codex

**Core principle**: Think deeply, follow TDD strictly, capture learnings while context is fresh.

**Quick reference:**
- ALWAYS FOLLOW TDD - no production code without failing test
- Assess refactoring after every green (but only if adds value)
- Update AGENTS.md when introducing meaningful changes
- Ask yourself "What do I wish I'd known at the start?" after significant changes
- Document gotchas, patterns, decisions, edge cases while context is fresh

For detailed TDD workflow, load the `tdd` skill.
For refactoring methodology, load the `refactoring` skill.
For detailed guidance on expectations and documentation, load the `expectations` skill.

## Resources and References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Testing Library Principles](https://testing-library.com/docs/guiding-principles)
- [Kent C. Dodds Testing JavaScript](https://testingjavascript.com/)
- [Functional Programming in TypeScript](https://gcanti.github.io/fp-ts/)

## Summary

The key is to write clean, testable, functional code that evolves through small, safe increments. Every change should be driven by a test that describes the desired behavior, and the implementation should be the simplest thing that makes that test pass. When in doubt, favor simplicity and readability over cleverness.