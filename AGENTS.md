# Repository Guidelines

This is a TypeScript monorepo for CodeSentinel. Optimize for safe, incremental changes that preserve determinism, package boundaries, and the existing code shape.

## Default Principle

Preserve behavior and structure by default. Deviate deliberately when a better solution is clearly more coherent with the repo.

## Source Of Truth

- Make code changes in `packages/*/src`.
- Treat `packages/*/dist`, `coverage`, and other generated output as build artifacts. Do not edit them directly.
- Keep shared contracts in `packages/core` only when they are genuinely cross-package.
- Keep package entrypoints intentional. Do not casually expose internal files as public surface area.

## Canonical Commands

- Use `pnpm` as the package manager.
- Prefer repo scripts over ad hoc commands when a script already exists.
- Canonical commands:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`

## Architecture

- Preserve package boundaries and dependency direction.
- Keep `cli` as the composition root. Do not move core scoring or analysis logic into it.
- Keep engine and analyzer packages focused on their own responsibility.
- Preserve the existing `application` / `domain` / `infrastructure` split where it already exists.
- Keep `domain` logic pure where possible. Keep I/O, runtime adapters, and external system concerns at the edges.
- Reuse existing domain language and extend existing concepts before inventing near-duplicate ones.
- Extend an existing package before creating a new one. Create a new package only when the boundary is real and improves the monorepo's cohesion.
- Keep the HTML report app aligned with its existing UI patterns, and do not leak UI-specific concerns back into engine packages.

## Change Scope

- Prefer the minimum necessary change set.
- Prefer the simplest solution that fits the current patterns and solves the actual problem.
- Keep changes local and incremental unless the task clearly requires broader restructuring.
- Preserve local consistency first, but do not copy weak patterns when they conflict with the repo's stronger principles.
- Avoid broad refactors, file moves, import reshuffles, formatting sweeps, or structure cleanup unless the task explicitly asks for them.
- Tiny adjacent cleanup is acceptable only if it is directly in the touched area and clearly low-risk.
- Agents may suggest a better approach, but should not silently expand scope to implement a broader idea.

## Contracts And Boundaries

- Preserve public contracts, CLI behavior, and serialized output shapes unless the task explicitly requires changing them.
- Preserve stable ordering in emitted arrays, rankings, tables, violations, reports, and snapshots.
- Make unavailable or degraded states explicit. Do not hide semantic failures behind silent fallbacks.
- Treat deterministic output as part of correctness.
- Treat package exports, shared types, report output, snapshot output, and CLI flags as high-sensitivity boundaries.

## Ask Before Changing

- Package boundaries or dependency direction.
- Public contracts, exported types, or package entrypoints when the need for the change is not already explicit in the task.
- CLI behavior, report formats, or snapshot formats when the need for the change is not already explicit in the task.
- Established local patterns when the change would introduce a new pattern or meaningfully depart from the current one.
- Dependencies or lockfiles.
- Anything that appears to require a broader architectural change.

## Types, Tests, And Style

- Preserve the current TypeScript strictness posture.
- Avoid `any` unless the boundary is genuinely dynamic and there is no better type.
- Do not use `eslint-disable` as the default escape hatch. Fix the underlying issue instead.
- If `any`, `eslint-disable`, `@ts-ignore`, or `@ts-expect-error` seems necessary, ask first.
- Prefer concrete, domain-shaped code over premature abstractions, generic helpers, or new layers of indirection.
- Prefer clear domain names over vague names like `utils`, `helpers`, or `manager`.
- Keep pure logic separable from I/O when that improves determinism and testing.
- Add or update tests when behavior, scoring, parsing, formatting, or package APIs change.
- Prefer small deterministic tests with inline fixtures.
- Verify changes proportionally. Prefer targeted checks first, and run broader checks when shared contracts or multiple packages are affected.
- Prefer clear code over comments. Add comments only for non-obvious invariants, ordering requirements, or deliberate tradeoffs.

## Documentation

- Update documentation when a change materially alters behavior, package boundaries, CLI usage, or scoring semantics.
- Improve coherence incrementally in the area you touch, but do not widen scope just to normalize older inconsistencies.

## Git And Workspace Behavior

- Do not create commits unless the task explicitly asks for one.
- Work in the current branch and current workspace state.
- If the repo is dirty, do not revert unrelated changes.

## Commit Messages And Releases

- When a commit is explicitly requested, use Conventional Commits.
- Treat commit type and scope as part of release semantics, not just commit formatting.
- Preserve semver expectations. Do not make breaking changes without making that explicit.
