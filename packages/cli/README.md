# CodeSentinel CLI

CodeSentinel is a structural, evolutionary, and dependency risk analysis CLI for TypeScript/JavaScript repositories, with an additional deterministic health posture score.

## Requirements

- Node.js 22+
- pnpm

## Install

Global:

```bash
npm install -g @getcodesentinel/codesentinel
```

Project-local (recommended for CI):

```bash
npm install --save-dev @getcodesentinel/codesentinel
```

## Commands

```bash
codesentinel analyze [path]
codesentinel run [path]
codesentinel explain [path]
codesentinel report [path]
codesentinel check [path]
codesentinel ci [path]
codesentinel dependency-risk <dependency[@version]>
```

## Common Usage

Analyze current repo:

```bash
codesentinel analyze
```

Full JSON output:

```bash
codesentinel analyze --json
```

`analyze --json` includes both `risk` and `health` blocks.

Score direction: `riskScore` higher = worse, `healthScore` higher = better.

Health v2 uses deterministic local signals:

- modularity concentration (cycles, fan/centrality, hotspot overlap)
- change-hygiene concentration (churn/volatility/co-change)
- test posture (presence + ratio + test directories)
- ownership distribution (author concentration and entropy)

Run analyze + explain + report in one command:

```bash
codesentinel run --detail full
```

Explain top hotspots:

```bash
codesentinel explain --top 5 --format md
```

Generate report:

```bash
codesentinel report --format md --output codesentinel-report.md
```

CI run with auto baseline:

```bash
codesentinel ci --baseline-ref auto --fail-on error
```

Dependency candidate scan:

```bash
codesentinel dependency-risk react@19.0.0
```

## Key Options

`analyze` and `explain`:

- `--author-identity likely_merge|strict_email`
- `--risk-profile default|personal`
- `--log-level silent|error|warn|info|debug`
- `--recent-window-days <days>`

`run`:

- `--format text|md|json`
- `--detail compact|standard|full` (default: `compact`)
- explain selectors: `--file <path>` / `--module <name>` / `--top <count>`
- report snapshot/diff: `--snapshot <path>` / `--compare <baseline.json>` / `--no-trace`

Risk profile behavior:

- `default`: balanced team-oriented scoring.
- `personal`: down-weights single-maintainer ownership penalties for both risk and health ownership scoring.
- `personal` does not suppress structural fragility, churn/volatility, dependency pressure, or interaction amplification, so elevated scores are still possible.

`analyze`:

- `--output summary|json`
- `--json`

`explain`:

- `--file <path>`
- `--module <name>`
- `--top <count>`
- `--format text|json|md`

`report`:

- `--format text|json|md`
- `--output <path>`
- `--snapshot <path>`
- `--compare <baseline.json>`
- `--no-trace`
- `--risk-profile default|personal`
- `--recent-window-days <days>`

`check`:

- `--compare <baseline.json>`
- `--max-risk-delta <value>`
- `--max-health-delta <value>`
- `--no-new-cycles`
- `--no-new-high-risk-deps`
- `--max-new-hotspots <count>`
- `--new-hotspot-score-threshold <score>`
- `--max-risk-score <score>`
- `--min-health-score <score>`
- `--fail-on error|warn`
- `--risk-profile default|personal`
- `--recent-window-days <days>`

`ci`:

- `--baseline <path>`
- `--baseline-ref <ref|auto>`
- `--baseline-sha <sha>` (when using `--baseline-ref auto`)
- `--main-branch <name>` (repeatable) or `--main-branches <csv>`
- `--snapshot <path>`
- `--report <path>`
- `--json-output <path>`
- `--risk-profile default|personal`
- gate options from `check`

`dependency-risk`:

- `--output summary|json`
- `--json`
- `--max-nodes <count>`
- `--max-depth <count>`

## Development Usage

From this monorepo, pass command args after `--`:

```bash
pnpm dev -- analyze .
pnpm dev -- run . --format text
pnpm dev -- explain . --top 5
pnpm dev -- report . --format md --output report.md
pnpm dev -- ci . --baseline-ref auto --fail-on warn
```

## Notes

- Logs are emitted to `stderr`; command output is emitted to `stdout`.
- For deterministic CI baseline resolution with `--baseline-ref auto`, fetch sufficient git history.
- Root documentation is in the repository `README.md`; this package README is a CLI-focused summary.
