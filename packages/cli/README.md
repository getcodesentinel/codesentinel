# CodeSentinel CLI

CodeSentinel is a structural, evolutionary, and dependency risk analysis CLI for TypeScript/JavaScript repositories.

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
- `--log-level silent|error|warn|info|debug`

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

`check`:
- `--compare <baseline.json>`
- `--max-repo-delta <value>`
- `--no-new-cycles`
- `--no-new-high-risk-deps`
- `--max-new-hotspots <count>`
- `--new-hotspot-score-threshold <score>`
- `--max-repo-score <score>`
- `--fail-on error|warn`

`ci`:
- `--baseline <path>`
- `--baseline-ref <ref|auto>`
- `--baseline-sha <sha>` (when using `--baseline-ref auto`)
- `--main-branch <name>` (repeatable) or `--main-branches <csv>`
- `--snapshot <path>`
- `--report <path>`
- `--json-output <path>`
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
pnpm dev -- explain . --top 5
pnpm dev -- report . --format md --output report.md
pnpm dev -- ci . --baseline-ref auto --fail-on warn
```

## Notes

- Logs are emitted to `stderr`; command output is emitted to `stdout`.
- For deterministic CI baseline resolution with `--baseline-ref auto`, fetch sufficient git history.
- Root documentation is in the repository `README.md`; this package README is a CLI-focused summary.
