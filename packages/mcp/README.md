# @getcodesentinel/mcp

stdio MCP server for CodeSentinel. It exposes the ownership, risk, trend and reading-path data
that CodeSentinel already computes to MCP clients such as Claude Code, Claude Desktop, Cursor
and VS Code.

This package is a thin `bin` wrapper around `codesentinel mcp`; all analysis lives in the CLI.

```bash
npx -y @getcodesentinel/mcp
```

Use `CODESENTINEL_ROOT` when the client does not launch the process from the repository root.

```json
{
  "mcpServers": {
    "codesentinel": {
      "command": "npx",
      "args": ["-y", "@getcodesentinel/mcp"],
      "env": { "CODESENTINEL_ROOT": "/path/to/repository" }
    }
  }
}
```

All tools are read-only except `run_scan`, which writes a snapshot under
`.codesentinel/snapshots`. Logs go to stderr; stdout carries only MCP JSON-RPC messages.

See the [MCP server section](https://github.com/getcodesentinel/codesentinel#mcp-server) in the
main README for registration snippets, the tool table and security notes.
