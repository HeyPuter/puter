---
title: MCP Server
description: Connect your AI tools to Puter with the Puter MCP server, and let them act on your Puter resources on your behalf.
---

[MCP (Model Context Protocol)](https://modelcontextprotocol.io) is the standard for connecting LLMs to platforms like Puter. With the Puter MCP server, you can let your AI tools (Claude Code, Codex, or any other MCP-compatible client) interact with your Puter resources on your behalf: managing files, publishing websites, deploying workers, and more.

## Installation

The Puter MCP server is hosted at [mcp.puter.com](https://mcp.puter.com). There's nothing to install or run yourself. Just point your AI tool at it and authenticate with your Puter account.

<div style="overflow:hidden; margin-top: 30px; margin-bottom: 20px;">
    <div class="example-group active" data-section="claude-code" data-icon="claude_code_outline" data-icon-active="claude_code_active"><i class="icon"></i><span>Claude Code</span></div>
    <div class="example-group" data-section="codex" data-icon="codex_outline" data-icon-active="codex_active"><i class="icon"></i><span>Codex</span></div>
    <div class="example-group" data-section="cursor" data-icon="cursor_outline" data-icon-active="cursor_active"><i class="icon"></i><span>Cursor</span></div>
    <div class="example-group" data-section="opencode" data-icon="opencode_outline" data-icon-active="opencode_active"><i class="icon"></i><span>OpenCode</span></div>
</div>

<div class="example-content" data-section="claude-code" style="display:block;">

Run this command in your terminal:

```bash
claude mcp add --transport http --scope user puter https://mcp.puter.com/
```

Then run `/mcp` inside Claude Code to authenticate with Puter.

</div>

<div class="example-content" data-section="codex">

Run this command in your terminal:

```bash
codex mcp add puter --url https://mcp.puter.com/
```

You'll be sent to authenticate with Puter automatically.

</div>

<div class="example-content" data-section="cursor">

Add Puter to the `mcpServers` section of your [Cursor MCP config](https://cursor.com/docs/mcp). Use `~/.cursor/mcp.json` to enable it everywhere, or `.cursor/mcp.json` in a project to scope it there:

```json
{
  "mcpServers": {
    "puter": {
      "url": "https://mcp.puter.com/"
    }
  }
}
```

Cursor handles the OAuth flow automatically. Open **Cursor Settings → MCP** and click the login button next to the `puter` server to authenticate with Puter.

</div>

<div class="example-content" data-section="opencode">

Add Puter to the `mcp` section of your [OpenCode config](https://opencode.ai/docs/mcp-servers/) (`opencode.json` in your project, or `~/.config/opencode/opencode.json` globally):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "puter": {
      "type": "remote",
      "url": "https://mcp.puter.com/",
      "enabled": true
    }
  }
}
```

OpenCode handles the OAuth flow automatically, so it'll send you to authenticate with Puter the first time it needs access. You can re-run it anytime with `opencode mcp auth puter`.

</div>

<div class="info">Using a different MCP client? Point it at the HTTP endpoint <code>https://mcp.puter.com/</code>. The server uses OAuth, so your client will guide you through signing in to Puter.</div>

## Usage

Once connected, just ask your LLM to interact with your Puter account in plain language. For example:

- "List the files in my Puter home directory."
- "Publish the `dist` folder as a website."
- "Deploy this script as a Puter worker and give me the URL."

Your AI tool picks the right Puter tools to carry out the request, acting as you.

## Tools

The Puter MCP server exposes the following tools, grouped by category. Each one mirrors the equivalent [Puter.js](/) SDK call.

### Filesystem

- `fs_write_file`: Create or overwrite a file in your Puter filesystem.
- `fs_read_file`: Read a file's contents (UTF-8 text, or base64 for binary).
- `fs_readdir`: List the files and subdirectories in a directory.
- `fs_mkdir`: Create a directory, optionally creating missing parents.
- `fs_stat`: Get metadata (name, size, type, timestamps) for a file or directory.
- `fs_delete`: Delete a file or directory.

### Hosting

- `hosting_create`: Publish a static website, served at `<subdomain>.puter.site`.
- `hosting_list`: List the websites you've published.
- `hosting_get`: Get a single published website and the directory it serves.
- `hosting_update`: Re-point a website at a different directory.
- `hosting_delete`: Unpublish a website.

### Workers

- `workers_create`: Deploy a serverless [Worker](/Workers/) from a JavaScript file and get its public URL.
- `workers_exec`: Call a deployed worker over HTTP, authenticated as you.
- `workers_list`: List your deployed workers.
- `workers_get`: Get a single worker's public URL and source file.
- `workers_delete`: Undeploy a worker.

### Apps

- `apps_create`: Register a launchable Puter app pointing at a URL.
- `apps_check_name`: Check whether an app name is available before creating it.
- `apps_list`: List the apps you own.
- `apps_get`: Get a single app, including its usage stats.
- `apps_update`: Update or rename an existing app.
- `apps_delete`: Unregister an app.

### Documentation

- `puter_docs_index`: Load the index of Puter.js documentation to discover available topics.
- `puter_docs_get`: Fetch a specific documentation page as Markdown.

### Account

- `whoami`: Get your account info, including username and home directory.
