# Atlas

[![Issues](https://img.shields.io/github/issues/skywalkerx28/Atlas.svg)](https://github.com/skywalkerx28/Atlas/issues)

## What is Atlas?

Atlas is an agent-centric development environment for the Software 3.0 era. Built from the Code - OSS codebase, Atlas is evolving into a **factory management system** for orchestrating swarms of AI agents across the entire software development lifecycle.

Atlas is not primarily a code editor. It is a command center where software engineers observe, direct, and manage fleets of autonomous agents working in parallel on long-standing tasks — from planning and implementation through review, testing, and deployment.

### Vision

The future of software development is agent-first. Hundreds of agents will work concurrently under enterprise harnesses, tackling tasks independently over longer timescales with less human direction. Atlas is the IDE that surfaces this new reality:

- **Fleet Dashboard** — Real-time view of all active agents, their roles, tasks, status, and cost
- **Objective Pipeline** — Manage the flow of work from high-level product intent through agent-executable subtasks
- **Agent Inspector** — Deep dive into any agent's conversation, worktree, diffs, and output
- **Review Station** — Aggregated view of pending reviews, judge decisions, and merge queue
- **Cost & Health Monitor** — Budget utilization, circuit breakers, and system health

### Architecture

Atlas extends the VS Code layered architecture with a dedicated **Agent Sessions Window** (`src/vs/sessions/`), a specialized workbench optimized for agent session workflows with a simplified, chat-first UX.

```
vs/base          <- Foundation utilities
vs/platform      <- Platform services
vs/editor        <- Text editor core
vs/workbench     <- Standard workbench
vs/sessions      <- Agent sessions window (this layer)
```

The sessions layer sits alongside `vs/workbench` and may import from it, but not vice versa. See [src/vs/sessions/README.md](src/vs/sessions/README.md) for the detailed architecture and [src/vs/sessions/LAYOUT.md](src/vs/sessions/LAYOUT.md) for the layout specification.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (see `.nvmrc` for the required version)
- [Yarn](https://yarnpkg.com/) or npm
- Python (for native module compilation)
- Platform-specific build tools (see below)

### Build from Source

```bash
git clone https://github.com/skywalkerx28/Atlas.git
cd Atlas
npm install
npm run compile
```

### Run in Development

```bash
bash scripts/code.sh
```

### Development Container

This repository includes a Dev Container configuration for working in an isolated environment. See [.devcontainer/README.md](.devcontainer/README.md) for setup instructions.

## Repository Structure

```
src/              Main TypeScript source code
  vs/base/        Foundation utilities and cross-platform abstractions
  vs/platform/    Platform services and dependency injection
  vs/editor/      Text editor implementation
  vs/workbench/   Main application workbench
  vs/sessions/    Agent sessions window (agent-first workbench)
  vs/code/        Electron main process
  vs/server/      Server implementation
build/            Build scripts and CI/CD tools
extensions/       Built-in extensions
test/             Integration tests
scripts/          Development and build scripts
resources/        Static resources (icons, themes, packaging)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to Atlas.

## License

Copyright (c) Atlas Contributors. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.

This project is derived from [Code - OSS](https://github.com/microsoft/vscode) by Microsoft Corporation, also licensed under MIT.
