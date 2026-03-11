# Atlas — Product Vision

> The editor does not disappear, but it stops being the center of gravity.
>
> The old IDE: **file → symbol → edit**
> Atlas: **requirement → blueprint → objective → swarm → task → agent → artifact → review → merge → deploy**
>
> Files become one inspection surface among many, not the primary navigation model.
> Do not ask "where is the file tree?"
> Ask "what does the operator need to supervise 50–500 active software processes safely?"

---

## Product Direction

Atlas is a **software factory control plane**, not a chat-enhanced editor.

It is the only tool an engineering team opens. Not one tool for requirements, another for architecture, another for coding, another for review, another for CI/CD, another for monitoring. One factory. Full SDLC. Every stage agent-assisted, every transition traceable, every divergence detected.

Atlas is the IDE for the entire software team — tech leads, engineers, PMs, reviewers, DevOps — to command, observe, and govern fleets of autonomous agents working across the full software development lifecycle.

## Operating Model

Atlas is a **project-level control plane** backed by **one harness fabric per project window**.

That harness fabric is not meant to be cloned into a separate process, database, and memory universe for every task by default. The current harness already behaves as one shared orchestration substrate per project: one DB, one repo root, one artifact root, one harness home, one metrics path, and many concurrent dispatches multiplexed inside that shared domain.

The first-class execution unit Atlas should surface is the **objective/task swarm**:

- one project opened in Atlas
- one harness fabric backing that project
- many concurrent swarms inside that fabric
- each swarm rooted at an objective or root task
- each swarm owning its own memory lane, worktree/artifact lane, review lane, and agent graph

This is the right fit for the current harness and for the product we are building. It preserves shared fleet visibility, merge control, review control, and memory promotion, while still giving each piece of work a clear execution boundary.

## What Atlas Is Not

- Not a session-first IDE where one chat thread is the primary noun
- Not a file-tree-first editor where the explorer is the home screen
- Not a process-per-task harness launcher by default
- Not just a coding surface for engineers; it is the operating surface for the full software team

### Why Full SDLC

Every competitor covers only a slice:

```
              Require  Architect  Plan  Execute  Review  Merge  Deploy  Monitor
8090          ████████ █████████  ████  ░░░░░░░  ░░░░░░  ░░░░░  ░░░░░░  ░░░░░░
Factory       ░░░░░░░░ ░░░░░░░░░  ░░░░  ███████  ░░░░░░  ░░░░░  ░░░░░░  ░░░░░░
Cursor        ░░░░░░░░ ░░░░░░░░░  ████  ███████  ░░░░░░  ░░░░░  ░░░░░░  ░░░░░░
Devin         ░░░░░░░░ ░░░░░░░░░  ░░░░  ███████  ░░░░░░  ░░░░░  ░░░░░░  ░░░░░░
Harness       ░░░░░░░░ ░░░░░░░░░  ████  ███████  ██████  █████  ░░░░░░  ░░░░░░
Atlas         ████████ █████████  ████  ███████  ██████  █████  ██████  ██████
```

8090's key insight is correct: "Development itself has never been the bottleneck. The actual friction is deciding what to build, why, and how it fits into the larger system." They solved upstream but punt on execution. The harness solved execution but starts cold with no upstream context. Atlas closes the loop — end to end.

---

## First-Class Nouns

These are the core entities in Atlas. Every surface, navigation path, and interaction is organized around them.

### Upstream (Before Agents Code)

| Noun | Definition |
|------|-----------|
| **Requirement** | A product need with acceptance criteria and stakeholder ownership. Traces forward to blueprints and objectives. Lives upstream of everything. Supports conversational elicitation, iterative refinement, and stakeholder approval gates. |
| **Blueprint** | An architectural decision or design: system diagram, API spec, data model, foundation document (cross-cutting technical decisions like tech stack, security standards). Traces to requirements and to code. Subject to continuous drift detection. |

### Execution (The Factory Floor)

| Noun | Definition |
|------|-----------|
| **Objective** | A high-level product goal derived from requirements. It is the strategic unit that owns execution intent and usually roots one primary swarm. Lifecycle: Open → Planning → Executing → Reviewing → Completed/Failed. Links back to the requirements and blueprints that motivated it. |
| **Task Swarm** | The primary execution unit Atlas operators supervise. A swarm is the live execution graph rooted at an objective or root task: its task DAG, agents, worktrees, memory lane, artifacts, reviews, and costs. It is the software-factory replacement for the old notion of a single "session." |
| **Task** | A unit of work inside a swarm. Has acceptance criteria, constraints, priority, budget, dependencies, and a handoff type (planning/specification/implementation/verification/review). |
| **Agent** | An autonomous process with a role (planner, worker, judge). Has state: active, idle, blocked, reviewing, completed, failed. Operates in an isolated worktree. |
| **Worktree** | An isolated Git worktree owned by one agent for one task inside a swarm. Contains the agent's branch, commits, and file changes. |
| **Run** | A single agent execution inside a swarm: the conversation transcript, tool calls, duration, cost, and outcome. |
| **Artifact** | Any output: requirements docs, blueprints, specs, plans, task packets, result packets, diffs, evidence bundles, test reports, logs. |
| **Review** | A human or judge evaluation of agent output. Three phases: pre-execution, in-flight, post-execution. Has a verdict: approve, reject, needs changes. |
| **Policy** | Governance rules: sandbox constraints, exec-policy ACLs, cost caps, rate limits, model selection, writable roots, tool access. |

### Downstream (After Code Merges)

| Noun | Definition |
|------|-----------|
| **Merge Lane** | The integration pipeline: PR queue, judge verdicts, promotion authorization, merge execution, rollback signals. |
| **Deployment** | A release pipeline execution: build → staging → production, with gates, rollback points, health checks, and agent-driven CI failure resolution. |
| **Incident** | A production issue. Can auto-create objectives, triggering the full agent pipeline to investigate, fix, and deploy. Closes the feedback loop from production back to requirements. |

---

## Continuous Drift Detection

The cross-cutting capability that makes full SDLC coverage transformative, not just broad.

At every transition in the chain, Atlas monitors for divergence:

```
Requirement → Blueprint → Task Spec → Agent Code → Merged Code → Deployed → Production
     ↑             ↑            ↑            ↑            ↑            ↑           ↑
     └─────────────┴────────────┴────────────┴────────────┴────────────┴───────────┘
                              Continuous Drift Detection
```

| Drift Type | What It Detects | How It Surfaces |
|-----------|----------------|----------------|
| **Requirement ↔ Blueprint** | Blueprint doesn't cover a requirement. Requirement changed after blueprint was approved. | Attention flag on Blueprints view. Agent suggests blueprint update as color-coded diff. |
| **Blueprint ↔ Task Spec** | Task spec diverges from architectural intent. Missing acceptance criteria for blueprint constraints. | Warning on task in Objective Board. Pre-execution review highlights gap. |
| **Task Spec ↔ Agent Code** | Agent's implementation doesn't match what was specified. Acceptance criteria not met. | In-flight review surfaces divergence. Post-execution review shows spec-vs-output comparison. |
| **Blueprint ↔ Merged Code** | Codebase has drifted from architectural blueprints. Shared components that should be abstracted. Foundation decisions being violated. | Drift alert in Blueprints view. Background agent suggests realignment. |
| **Requirement ↔ Production** | Production behavior doesn't match original requirement intent. Feature regression. | Incident auto-created. Traces back through the full chain to identify where drift entered. |

Resolution is always human-in-the-loop or judge-gated: the agent explains the issue, suggests updates, and the operator approves or rejects.

This is the "continuous coherence" mechanism that no competitor has end-to-end. 8090 has it for requirements ↔ blueprints only. Atlas has it across the entire chain.

---

## The Shell

Atlas replaces the explorer-first VS Code shell with a factory-first layout organized around project -> objective -> swarm -> task -> agent.

```
┌──────────────┬────────────────────────────────────────┬──────────────────┐
│              │              Titlebar                   │                  │
│              │  [fleet status]  [objective]  [controls]│                  │
│   Left Rail  ├────────────────────────────────────────┤   Right          │
│              │                                        │   Inspector      │
│  ▸ Require.  │           Center Stage                 │                  │
│  ▸ Bluepr.   │                                        │  Selected:       │
│  ▸ Objectives│   studio, objective board, swarm board, │  requirement /   │
│  ▸ Swarms    │   agent view, fleet grid, diff view,   │  blueprint /     │
│  ▸ Tasks     │   code view, deployment pipeline,      │  swarm /         │
│  ▸ Agents    │   fleet grid, diff view, code view,    │  agent / task /  │
│  ▸ Reviews   │   deployment pipeline, incident view   │  worktree /      │
│  ▸ Artifacts │                                        │  tools / costs / │
│  ▸ Merges    │                                        │  approvals /     │
│  ▸ Deploys   │                                        │  reasoning /     │
│  ▸ Fleet     │                                        │  drift alerts /  │
│  ▸ Ops       │                                        │  open files      │
│              ├────────────────────────────────────────┤                  │
│              │           Bottom Ops Strip              │                  │
│              │  terminals, logs, command output,       │                  │
│              │  MCP tools, runtime health, CI output   │                  │
└──────────────┴────────────────────────────────────────┴──────────────────┘
```

### Left Rail — Navigation

The primary orientation surface. Toggle between views:

| View | What It Shows |
|------|--------------|
| **Requirements** | Product needs, feature hierarchy, stakeholder approvals. Grouped by product area or priority. Drift alerts for requirements not yet covered by blueprints. |
| **Blueprints** | Architecture decisions, system diagrams, data models, foundation docs. Drift alerts for code divergence. Click a blueprint → opens in center with linked requirements and tasks. |
| **Objectives** | High-level goals flowing through the factory. Lifecycle stage, task progress, cost rollup. Click → opens Objective Board. |
| **Swarms** | The primary execution boards. Each swarm shows its objective/root task, active agents, task DAG, memory lane, worktrees, reviews, and costs. Click → opens Swarm Board. |
| **Tasks** | The work pipeline: queued, executing, in review, completed. Grouped by swarm, objective, or priority. Click a task → opens it in center. |
| **Agents** | Every agent in the fleet with live status: active, idle, blocked, reviewing, failed. Filters by role, status, objective. Click an agent → opens its execution view. |
| **Reviews** | Pending review queue: tasks awaiting human verdict. Count badge always visible. Batch review workflow. |
| **Artifacts** | Specs, plans, packets, evidence, logs, outputs. Organized by objective/task. |
| **Merges** | PR queue, judge verdicts, promotion lane, conflict map. |
| **Deployments** | Release pipelines, environment status, rollback controls. CI/CD health. |
| **Fleet** | Operational overview: pool capacity, health indicators, cost burn, SLA timers. |
| **Ops** | Policy, sandboxes, auth, cost caps, audit trail, MCP servers, incidents. |

Files are accessible as a subordinate view — either scoped to a selected swarm or selected agent's worktree, or as a fallback traditional tree for manual work. They are not the default.

### Center Stage — Focus

Whatever the operator is supervising right now:

| Mode | When |
|------|------|
| **Requirements Workshop** | Authoring and refining requirements. Conversational elicitation with an agent. Feature hierarchy editor. Stakeholder review and approval. |
| **Blueprint Studio** | Viewing or editing architectural blueprints. System diagrams, API designs, data models. Drift alerts overlaid on the blueprint. Linked requirements and tasks visible. |
| **Objective Board** | Viewing the decomposition tree, dependencies, ownership, current stage, review gates for an objective. |
| **Swarm Board** | Supervising one live swarm: objective linkage, task DAG, active agents, memory lane, worktrees, artifacts, and review state. This is the default execution board. |
| **Agent Execution View** | Watching or reviewing a single agent: transcript, tool calls, diffs, touched files, branch/worktree, terminal, artifacts. |
| **Fleet Grid** | Tmux-style grid of live agent cards. Each card: agent name, task, latest activity, cost, health. Click to expand. Maximize per monitor. |
| **Diff View** | Agent's changeset: per-file diffs, approve/reject hunks, spec compliance check. |
| **Code View** | Traditional file editor — opens as modal overlay or split when you need to inspect source. |
| **Deployment Pipeline** | Release pipeline visualization: build → staging → production. Gate status, health checks, rollback controls. |
| **Incident View** | Production issue investigation: auto-triage, linked traces, agent-generated fix proposals, deployment path. |

### Right Inspector — Context

Detail panel for the currently selected entity:

- **Requirement selected**: description, acceptance criteria, stakeholder, approval status, linked blueprints, linked objectives, drift alerts
- **Blueprint selected**: type (foundation/system diagram/feature), linked requirements, linked tasks, drift status vs. codebase, change history
- **Objective selected**: lifecycle stage, task DAG, progress, cost rollup, timeline estimate
- **Swarm selected**: root objective/task, active agents, DAG state, memory scope, worktrees, review phase, aggregate cost, bottlenecks
- **Agent selected**: role, task, status, cost so far, recent reasoning, open files, worktree, tools available, model, policy constraints
- **Task selected**: spec, acceptance criteria, assigned agent, dependencies, priority, budget, stage, artifacts produced, linked blueprint
- **Worktree selected**: branch, commits, file tree, diff summary, merge status
- **Review selected**: verdict history, judge reasoning, approval chain, merge readiness
- **Deployment selected**: pipeline stage, environment, health checks, rollback path, linked merge

### Bottom Ops Strip — Operations

- Terminals (agent terminals, user terminal)
- Logs (agent logs, harness logs, build output)
- Command output (harness CLI results)
- MCP tools (connected servers, tool invocations)
- Runtime health (disk, memory, NATS, WAL, circuit breaker)
- CI/CD output (build status, test results, deployment logs)

### Titlebar — Global

- **Left**: Toggle left rail, fleet status badge (N active / N idle / N needs review / N drift alerts)
- **Center**: Current project/objective/swarm selector
- **Right**: Pause all, cost indicator ($X / $Y budget), health indicator, drift alert count, user account

---

## Thirteen Core Surfaces

These are core to Atlas, not add-ons. Each is a first-class experience.

### Upstream Surfaces

#### 1. Requirements Workshop

Where product needs are defined before anything is built. "What should we build and why?"

- **Conversational elicitation**: An agent interviews stakeholders to extract and refine requirements through iterative Q&A, not one-shot generation
- **Feature hierarchy**: Requirements organized into product areas, features, and acceptance criteria
- **Stakeholder approval**: Review gates before requirements flow into blueprints and objectives
- **Traceability forward**: Every requirement links to the blueprints, objectives, tasks, and eventually code that fulfill it
- **Drift alerts**: Requirements that have no corresponding blueprint or objective are flagged
- Actions: create requirement, refine with agent, approve, link to blueprint, create objective

#### 2. Blueprint Studio

Where architectural decisions live. "How should we build it?"

- **Foundation documents**: Cross-cutting technical decisions — tech stack, security standards, coding conventions, infrastructure patterns. Applied across all features.
- **System diagrams**: ERDs, flow diagrams, component architecture, API surface area. Visual + structured.
- **Feature blueprints**: Per-feature technical plans — APIs, UI behavior, data models, testing strategy. Linked to the requirement that motivated them.
- **Agent-assisted review**: An architecture agent analyzes blueprints for gaps, ambiguities, and conflicts with existing foundations
- **Continuous drift detection**: Background comparison of blueprints vs. actual codebase. Alerts when code diverges from architectural intent. Suggests realignment as color-coded diffs.
- **Configurable extraction strategies**: Teams set decomposition style (feature-slice vs. specialist-oriented) for how blueprints become task specs. Custom strategies supported.
- Actions: create blueprint, edit, run drift check, link to requirement, generate tasks from blueprint

### Execution Surfaces

#### 3. Fleet Command

All live agents at a glance. The operator's primary awareness surface.

- Agent list with live state: active, idle, blocked, needs review, failed, over-budget
- **Idle detection**: Highlight agents not making progress, stuck in loops, or waiting on unresolved dependencies
- **Attention flags**: Agents that need human intervention bubble to the top
- **Cost burn**: Per-agent and aggregate cost with rate-of-spend indicators
- **SLA timers**: Time-in-state for each agent. How long has it been executing? How long blocked?
- **Pool capacity**: N/M slots used, queue depth, fan-out utilization
- **Swarm grouping**: Toggle between global fleet view and grouped-by-swarm view
- Actions: pause, cancel, reprioritize, restart, reassign

#### 4. Objective Board

The strategic view. How product goals flow through the factory.

- **Decomposition tree**: Objective → subtask DAG with dependencies, owners, stages
- **Stage tracking**: Each task's position: queued → executing → reviewing → completed
- **Review gates**: Which tasks are blocked waiting for human approval
- **Ownership**: Which agent owns which task, which tasks are unassigned
- **Cost rollup**: Total spend per objective, projected completion cost
- **Timeline**: Estimated completion based on current throughput
- **Blueprint link**: Which architectural blueprints this objective implements. Drift indicator if they have diverged.
- Actions: replan, reprioritize, add/remove tasks, modify constraints

#### 5. Agent Execution View

Deep inspection of a single agent. Like reading over its shoulder.

- **Transcript**: Full conversation with system prompt, tool calls, reasoning, decisions
- **Tool calls**: Inline display of file reads, edits, terminal commands, search results
- **Diffs**: Files changed by this agent, live-updating during execution
- **Touched files**: List of all files the agent has read or modified
- **Worktree**: Current branch, commits, merge status
- **Terminal**: The agent's terminal session, if applicable
- **Artifacts**: Specs, plans, result packets produced by this agent
- **Cost**: Running total with per-tool-call breakdown
- **"Jump to decision"**: Skip to the moments where the agent made key architectural choices

#### 6. Pre-Execution Review

Before work begins. "Should this plan proceed?"

- **Task spec**: What is being asked, acceptance criteria, constraints, writable roots
- **Plan preview**: Planner's decomposition — subtask graph, dependencies, parallel limits
- **Tool scope**: What tools the agent will have access to, what commands are allowed/forbidden
- **Model choice**: Which LLM is assigned, cost implications
- **Budget**: Allocated budget for this task/objective, cost ceiling
- **Risk assessment**: Files that will be touched, blast radius, potential conflicts with other running agents
- **Policy compliance**: Sandbox constraints, exec-policy rules that will apply
- **Blueprint alignment**: Does this task spec align with the relevant architectural blueprint?
- Actions: approve plan, modify constraints, adjust budget, reject, reprioritize, request clarification

#### 7. In-Flight Review

During execution. "Is it on track? Should I intervene?"

- **Live transcript**: Streaming conversation with tool calls
- **Live diff**: Files changing in real-time
- **Cost accumulator**: Running total with budget warning as it approaches ceiling
- **Progress indicators**: Is the agent making meaningful progress or spinning?
- **Steering controls**: Send a redirect message, pause, cancel, branch into new direction
- **Escalation**: Attach additional context, add a reviewer agent, flag for human
- **Comparison to spec**: Side-by-side of what was asked vs. what is being done

#### 8. Post-Execution Review

After completion. "Did it do good work?"

- **Result summary**: Status (done/blocked/failed), acceptance criteria pass/fail with evidence
- **Full diff**: Complete changeset with syntax-highlighted per-file diffs
- **Inline annotations**: Agent's reasoning from the transcript linked to the code it produced
- **Test evidence**: What tests ran, what passed/failed, coverage delta
- **Judge verdict**: If a judge reviewed, its go/no-go decision and reasoning
- **Spec compliance**: Side-by-side of task spec vs. actual output, criteria checklist
- **Blueprint compliance**: Does the output conform to the architectural blueprint?
- Actions: approve & merge, request changes (send back to agent), reject, escalate
- Auto-advance to next review item (batch review workflow)

#### 9. Merge Control

The integration pipeline. Getting agent work into the codebase safely.

- **PR queue**: All pending PRs from agent work, ordered by priority
- **Auto-review status**: Which PRs have been judge-reviewed, which need human review
- **Judge verdicts**: Go/no-go decisions with reasoning
- **Promotion lane**: Staging → integration → main, with gates at each transition
- **Conflict detection**: Which PRs conflict with each other, merge preview
- **Rollback signals**: One-click revert for any merged PR, blast radius indicator
- **Integration executor**: Trigger merge, monitor CI, handle failures

#### 10. Artifact Browser

All outputs organized and searchable.

- **By type**: Requirements, blueprints, specs, plans, task packets, result packets, evidence bundles, benchmarks, logs
- **By objective/task**: Drill down from requirement → blueprint → objective → task → artifacts
- **By agent**: What did this agent produce across all its runs?
- **Versioned**: Multiple versions of specs/plans/blueprints as they evolved
- **Linked**: Click an artifact → see the agent run that produced it, the task it belongs to, the review that evaluated it, the requirement that motivated it

### Downstream Surfaces

#### 11. Deployment Control

Release pipeline management. Getting merged code to production safely.

- **Pipeline visualization**: Build → staging → production with gate status at each transition
- **Environment status**: What version is deployed where. Health checks per environment.
- **Agent-driven CI resolution**: When builds fail, agents can investigate, propose fixes, and re-trigger. "Self-healing builds."
- **Rollback controls**: One-click rollback to any previous deployment. Blast radius indicator.
- **Deployment history**: Full audit trail of what was deployed when, by which merge, from which objective
- **Gate approvals**: Human or policy gates before production promotion
- Actions: trigger deploy, promote, rollback, investigate failure, pause pipeline

#### 12. Incident Response

Production issue management. Closing the feedback loop.

- **Auto-triage**: Production alerts ingested. Agent classifies severity, identifies likely cause, traces through the SDLC chain to find where the issue was introduced.
- **Root cause tracing**: Incident → merged PR → agent run → task spec → blueprint → requirement. Full provenance chain.
- **Fix pipeline**: Incident auto-creates an objective. Agents investigate, propose fix, human approves, agents implement, judge reviews, merge, deploy. The full factory loop triggered by a production event.
- **Regression detection**: When an incident traces back to a requirement that was previously satisfied, the drift detection system flags the regression.
- **Post-incident artifacts**: Evidence bundles, root cause analysis, fix verification, updated blueprints if architectural drift caused the issue.
- Actions: acknowledge, escalate, auto-create objective, assign to agent, link to requirement

#### 13. Ops / Policy

Governance, infrastructure, and factory configuration.

- **MCP servers**: Connected servers, available tools, invocation logs
- **Auth**: Provider configuration, signed-in accounts, token status
- **Sandboxes**: Active sandbox profiles, policy violations, enforcement logs
- **Cost caps**: Budget configuration, circuit breaker status, per-task/per-objective limits
- **Audit trail**: Every human decision (approval, rejection, steering) logged with timestamp and reasoning. Full traceability from requirement through deployment.
- **Failure modes**: Dead-letter queue, timed-out agents, crashed workers, recovery options
- **Rate limits**: Per-role rate profiles, current utilization
- **Model configuration**: Which models are available, cost per model, assignment rules
- **Incident log**: All production incidents with status and linked objectives

---

## Design Principles

### Attention Over Tabs
Attention management matters more than tab management. The operator's scarcest resource is focus. Atlas must surface what needs attention — agents blocked, reviews pending, budgets exceeded, tasks failed, drift detected, incidents open — without requiring the operator to go looking.

### Review Lanes Over Editor Chrome
Review lanes matter more than editor chrome. The three review surfaces (pre/in-flight/post) are the primary human workflow. They must be as fluid as writing code used to be. Keyboard-driven, batch-capable, auto-advancing.

### Agent State Over Open Files
Agent state matters more than open files. The sidebar shows agents, not files. The center shows agent output, not editor tabs. Files are an inspection tool you drill into, not the home screen.

### Intervention Over Edit Speed
Intervention ergonomics matter more than raw edit speed. When an agent is heading in the wrong direction, the operator needs to steer it in seconds. Pause, redirect, escalate, cancel — these must be instant and accessible.

### Full Chain Traceability
Every artifact in the system should be traceable back to the requirement that motivated it, through the blueprint that designed it, the objective that organized it, the task that specified it, the agent that built it, the review that approved it, and the deployment that shipped it. When something goes wrong, you should be able to follow the chain in either direction.

### Continuous Coherence
Drift detection is not a one-time check. It is a continuous background process that compares every layer against every other layer. Requirements vs. blueprints. Blueprints vs. code. Specs vs. output. When they diverge, Atlas surfaces it immediately — before the divergence compounds.

### Multi-Monitor Intentional
Multi-monitor layouts should be designed, not accidental:

| Monitor | Purpose | Default Surface |
|---------|---------|----------------|
| **Monitor 1** | Strategic oversight | Requirements + Blueprints + Objective board |
| **Monitor 2** | Active supervision | Fleet command + Agent execution view + worktree |
| **Monitor 3** | Quality control | Review queue + Merge control + Deployment pipeline |

### Bigger, Not Smaller
The age of the minimalist editor is over. Agents expand the conscious limits for humans to explore deeper and broader levels at once. Atlas must fill the screen with useful information density — not empty space and "getting started" pages.

---

## Implementation Order

### Phase 1: Vocabulary and State Model
Lock the product vocabulary. Define TypeScript interfaces for every first-class noun (Requirement, Blueprint, Objective, Task, Agent, Worktree, Run, Artifact, Review, Policy, MergeLane, Deployment, Incident). These become the shared type system that every surface consumes.

Build the **harness bridge service** (`IHarnessService`) — the IPC layer that reads from axiom-harness CLI output, SQLite state, and JSONL event streams and exposes it as observable state to the workbench.

### Phase 2: Navigation Rewrite
Replace explorer-first navigation with the full left rail: Requirements, Blueprints, Objectives, Tasks, Agents, Reviews, Artifacts, Merges, Deployments, Fleet, Ops.

The sidebar should feel immediately different from VS Code the moment you open Atlas.

### Phase 3: Fleet Panel and Attention Model
Build Fleet Command as a core surface. Implement the attention model: idle detection, blockers, over-budget, needs-review, failed, drift-detected. Agents that need human attention surface automatically.

This is where Atlas starts being useful even before the other surfaces exist — just seeing the fleet live is transformative.

### Phase 4: Three Review Surfaces
Build pre-execution, in-flight, and post-execution review as distinct but connected experiences. Implement batch review workflow with keyboard shortcuts and auto-advance.

This is the highest-leverage feature. It is what makes agents supervisable at scale.

### Phase 5: Files as Subordinate Inspection
Make files/worktrees a subordinate inspection tool, not the home screen. Agent-scoped file views. Diff views linked to the agent and task that produced them. Code view as a modal drill-down.

### Phase 6: Multi-Monitor Window Modes
Add intentional multi-monitor support with named window profiles: Operator (fleet + objectives), Executor (agent + worktree + tools), Reviewer (reviews + merge + artifacts), Ops (health + policy + audit).

### Phase 7: Upstream SDLC — Requirements and Blueprints
Build the Requirements Workshop and Blueprint Studio. Implement conversational requirement elicitation, feature hierarchy, architectural blueprint authoring, and configurable extraction strategies for task decomposition.

This extends Atlas from an execution monitor to a full planning surface. Agents now have structured upstream context instead of starting cold.

### Phase 8: Continuous Drift Detection
Implement the drift detection engine as a background process. Monitor requirement ↔ blueprint, blueprint ↔ code, spec ↔ output, and all intermediate transitions. Surface drift as attention flags across all relevant views.

This is the capability that makes full SDLC coverage transformative, not just broad.

### Phase 9: Downstream SDLC — Deployment and Monitoring
Build Deployment Control and integrate production monitoring. Agent-driven CI failure resolution, deployment pipelines, environment management, rollback controls.

### Phase 10: Incident Response and Full Loop Closure
Build Incident Response. Auto-triage production alerts, trace root cause through the full SDLC chain, auto-create objectives to fix issues. Close the feedback loop from production back to requirements.

At this point, Atlas covers the entire software lifecycle in a single surface.

---

## Mapping to Codebase

### Existing Foundation (`src/vs/sessions/`)

The sessions layer provides the workbench shell:
- Fixed layout: sidebar, chat bar, auxiliary bar, panel, titlebar
- Chat widget (becomes the base for agent transcript view and conversational requirement elicitation)
- Session management (becomes the base for agent/task selection)
- Changes view (becomes the base for agent-scoped diff view)
- Modal editor (becomes the code inspection drill-down)
- Contribution infrastructure for registering new views

### What Gets Built

| Surface | Location | Dependencies |
|---------|----------|-------------|
| Harness Bridge | `sessions/services/harness/` | axiom-harness CLI, SQLite, JSONL streams |
| State Model | `sessions/common/model/` | Harness bridge, TypeScript interfaces for all nouns |
| Requirements Workshop | `sessions/contrib/requirements/` | State model, chat widget (for elicitation) |
| Blueprint Studio | `sessions/contrib/blueprints/` | State model, drift detection engine |
| Tasks View | `sessions/contrib/tasksView/` | State model (dispatch queue) |
| Agents View | `sessions/contrib/agentsView/` | State model (pool status, activity stream) |
| Reviews View | `sessions/contrib/reviewsView/` | State model (result packets, review state) |
| Artifacts View | `sessions/contrib/artifactsView/` | State model (all artifact types) |
| Fleet View | `sessions/contrib/fleetView/` | State model (pool status, health, cost) |
| Objective Board | `sessions/contrib/objectiveBoard/` | State model (objective lifecycle, subtask DAG) |
| Agent Execution View | `sessions/contrib/agentView/` | State model (checkpoint replay, worktree diffs) |
| Pre-Execution Review | `sessions/contrib/review/pre/` | State model (task packets, plan preview) |
| In-Flight Review | `sessions/contrib/review/inflight/` | State model (live transcript, steering) |
| Post-Execution Review | `sessions/contrib/review/post/` | State model (result packets, judge verdicts) |
| Merge Control | `sessions/contrib/mergeControl/` | State model (merge queue, promotion lane) |
| Artifact Browser | `sessions/contrib/artifactBrowser/` | State model (all artifact types, full chain links) |
| Deployment Control | `sessions/contrib/deployments/` | State model, CI/CD integration |
| Incident Response | `sessions/contrib/incidents/` | State model, monitoring integration, drift detection |
| Drift Detection Engine | `sessions/services/drift/` | Blueprint store, codebase index, harness bridge |
| Ops / Policy | `sessions/contrib/ops/` | State model (sandbox, cost, audit, MCP, incidents) |
| Fleet Grid | `sessions/browser/widget/fleetGrid/` | State model (agent cards, live updates) |
| Multi-Monitor | `sessions/browser/windowModes/` | All surfaces, window management |

### Harness Data Sources

| Atlas Noun | Harness Source |
|-----------|---------------|
| Requirement | New — Atlas-native store (not in harness today). Feeds into `ObjectiveSpec`. |
| Blueprint | New — Atlas-native store. Informs planner context and drift detection. |
| Objective | `axiom-harness objective` lifecycle, `ObjectiveSpec` |
| Task | SQLite dispatch queue, `TaskPacket` |
| Agent | Pool status, `WorkerProcess`, activity stream JSONL |
| Worktree | `WorktreeRegistry` (SQLite), git operations |
| Run | Checkpoint replay, conversation transcripts |
| Artifact | File system (docs/plans/, docs/specs/, docs/packets/, docs/results/) + Atlas-native stores for requirements and blueprints |
| Review | `ResultPacket` (judge verdicts), review state in dispatch queue |
| Policy | Exec-policy rules, sandbox profiles, cost budget config |
| Merge Lane | Merge queue (SQLite), integration executor, promotion state |
| Deployment | New — CI/CD integration layer. Reads pipeline status, triggers deploys. |
| Incident | New — monitoring integration layer. Ingests alerts, creates objectives. |

### Architectural Learnings Incorporated

From the landscape research (`docs/research/software-factory-landscape-2026-03.md`):

| Source | Insight | Where It Appears in Atlas |
|--------|---------|--------------------------|
| 8090 | Conversational requirement elicitation, not one-shot | Requirements Workshop |
| 8090 | Architectural blueprints with drift detection | Blueprint Studio + Drift Detection Engine |
| 8090 | Configurable extraction strategies for decomposition | Blueprint Studio → task generation |
| 8090 | Context-rich work orders as self-contained prompts | Task packets enriched by requirement + blueprint context |
| Factory | Pre-computed codebase representation (HyperCode) | Drift Detection Engine codebase index (Phase 8) |
| Factory | Multi-trajectory sampling | Harness enhancement: fan-out workers on same task, judge-select best |
| Factory | DroidShield pre-commit static analysis | Automated pre-commit gate before judge review |
| Cursor | Equal-status agents fail; hierarchy required | Planner/worker/judge triad (already in harness) |
| Cursor | Quality gates > throughput | Judge role + three review surfaces |
| Yegge | Git-backed memory with hash-based IDs | Governed memory + workspace events (already in harness) |
| Yegge | Without quality gates, agents erase production databases | Sandbox enforcement + policy surface in Ops |
| DORA | 67% AI PR rejection rate without quality gates | Judge role + post-execution review + merge control |
| Boeckeler | Real gains come from orchestration and parallelism, not individual speed | Fleet Command + Objective Board (manage the factory, not the agent) |
