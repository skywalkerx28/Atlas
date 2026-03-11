# Atlas Docs

This directory is the source-of-truth for where Atlas is going and how the current VS Code fork is being refactored to get there.

## North Star

Atlas is a **software-factory control plane** for one project.

The architectural rule to keep in mind when reading every doc in this folder:

- one project opened in Atlas
- one harness fabric backing that project
- many concurrent objective/task swarms inside that fabric
- each swarm rooted at an objective or root task
- each swarm owning its own memory lane, worktree/artifact lane, review lane, and agent graph

Atlas is therefore:

- not a session-first IDE
- not a file-tree-first IDE
- not a separate harness process, DB, and memory universe per task by default

The first-class execution unit is the **task swarm**.

## Read Order

Start here if you are new to the repo:

1. `ATLAS_VISION.md`
   Product thesis, first-class nouns, shell, SDLC coverage, and why Atlas is bigger than a classic IDE.
2. `HARNESS_INTEGRATION.md`
   How Atlas connects to the Syntropic Harness and how swarms are derived from the existing harness fabric.
3. `SESSIONS_ARCHITECTURE.md`
   How the current `src/vs/sessions/` layer gets refactored from session-first UI into a swarm-first software-factory shell.
4. `DESIGN_NEEDS.md`
   Concrete surfaces and design work that need to be built next.
5. `FORK_CLEANUP.md`
   Product and codebase cleanup priorities for removing legacy VS Code/Copilot assumptions.

## What We Are Building

Atlas should cover the full software development lifecycle in one tool:

- requirements and upstream planning
- blueprints and architecture
- objective creation and decomposition
- long-running swarm execution
- pre-execution, in-flight, and post-execution review
- merge and deployment control
- drift detection and incident feedback loops

Files, tabs, and single chat sessions are subordinate inspection tools. They are not the primary navigation model.

## What Must Stay Consistent Across Docs

If you update one of these docs, keep these statements consistent across all of them:

- Atlas is a project-level control plane.
- The harness is a shared orchestration fabric per project window.
- Swarms are first-class in the UI and service model.
- Objectives are strategic units; swarms are execution units.
- Review, memory, worktrees, and artifacts are scoped through swarms.
- The shell is not explorer-first.

If a new proposal reintroduces session-first or file-tree-first assumptions, it is probably moving the product backwards.
