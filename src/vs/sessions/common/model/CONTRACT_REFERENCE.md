# Atlas Phase 0b Contract Reference

This folder implements the Atlas Phase 0b TypeScript contract from the current harness truth, not from older doc sketches.

## Primary harness sources used

- `syntropic-protocol/src/workspace_types.rs`
  - `WorkspaceEvent` (`crates/syntropic-protocol/src/workspace_types.rs:160`)
  - `HandoffType` (`crates/syntropic-protocol/src/workspace_types.rs:310`)
  - `ActivityEventKind` + `AgentActivityEvent` (`crates/syntropic-protocol/src/workspace_types.rs:360`, `:388`)
  - `ObjectiveSpec` (`crates/syntropic-protocol/src/workspace_types.rs:476`)
  - `TaskPacket*` support types and `TaskPacket` (`crates/syntropic-protocol/src/workspace_types.rs:849`, `:861`, `:879`, `:905`, `:922`, `:931`, `:941`)
  - `ResultPacketDecision`, `PromotionRecord`, `ResultPacket` (`crates/syntropic-protocol/src/workspace_types.rs:1003`, `:1045`, `:1085`)
- `syntropic-protocol/src/memory.rs`
  - `MemoryRecord` wire shape used by `IHarnessService.getMemoryRecords()` (`crates/syntropic-protocol/src/memory.rs:5`)
- `syntropic-protocol/src/lib.rs`
  - `DispatchPriority`, `WorkerState` (`crates/syntropic-protocol/src/lib.rs:51`, `:103`)
- `syntropic-core/src/pool.rs`
  - `worker_registry`, `dispatch_queue`, `pool_health` schema and record shapes (`crates/syntropic-core/src/pool.rs:10`, `:87`, `:99`, `:126`)
- `syntropic-core/src/objective.rs`
  - `ObjectiveStatus`, `ObjectiveRecord`, `ObjectiveContext` (`crates/syntropic-core/src/objective.rs:39`, `:89`, `:135`)
- `syntropic-core/src/objective_service.rs`
  - Root-task intake linkage and root planner packet materialization (`crates/syntropic-core/src/objective_service.rs:79`, `:338`)
- `syntropic-core/src/planner_hierarchy.rs`
  - `task_hierarchy`, `fan_out_registry`, `TaskNode`, `FanOutRequest` (`crates/syntropic-core/src/planner_hierarchy.rs:15`, `:53`, `:90`)
- `syntropic-core/src/review.rs`
  - Advisory review semantics and `ReviewQueueEntry` (`crates/syntropic-core/src/review.rs:10`, `:20`)
- `syntropic-core/src/merge_queue.rs`
  - `merge_queue`, `review_candidates`, `MergeQueueRecord`, `ReviewCandidateRecord` (`crates/syntropic-core/src/merge_queue.rs:13`, `:49`, `:145`, `:176`)
- `syntropic-core/src/event_queue.rs`
  - `workspace_event_queue` persistence states (`crates/syntropic-core/src/event_queue.rs:8`)

## Key invariants locked here

- Swarms are rooted by `rootTaskId`, not by `objectiveId`.
- `objectiveId` stays optional on swarm/task surfaces because ad-hoc roots and fan-out tasks can exist without objective linkage.
- `TaskPacket.acceptance` and `TaskPacket.constraints` stay array-shaped (`Vec<String>` in Rust).
- `ReviewDecision` wire values stay exactly `go`, `no-go`, and `n/a`.
- `wire.ts` mirrors raw serde payload shape:
  - omitted keys stay optional in TypeScript
  - non-skipped `Option<T>` fields stay nullable instead of being normalized away
- The review model stays split into:
  - Advisory queue (`review.rs`)
  - Authoritative gate state (`review_candidates`)
  - Merge execution (`merge_queue`)
- Review selection/navigation is keyed by `dispatch_id`, matching `review_candidates` and `merge_queue`.
- Raw harness state enums live in `wire.ts`; `task.ts` and `agent.ts` remain Atlas presentation contracts from the Phase 0b plan.

## Atlas doc drift found while implementing

- `DispatchCommand` is broader in Rust than the doc sketch:
  - `task_id` is optional
  - `from_role`, `subagent_nickname`, and `skip_gates` exist on the wire
- `ResultPacket.acceptance_results` uses `status: pass|fail|not_run`, not a boolean `met`.
- `ResultPacket` does not carry review/promotion/integration fields.
  - Those belong to `PromotionRecord` / `review_candidates` / `merge_queue`.
- `PromotionRecord` carries `reviewed_branch` and `reviewed_head_sha`, but reviewer attribution/timestamps live on `ReviewCandidateRecord`, not on `PromotionRecord`.
- Objective priority in the live harness is `DispatchPriority` (`p0|p1|p2|p3|info`), not `p0` through `p4`.
- `TaskPacket` in Rust already includes verified fields that older docs collapsed or omitted:
  - `phase_refs`
  - `context_paths`
  - `verification`
  - `review`
  - `preauthorized_next_step`
  - `push_authorization`
  - `parallelization`
  - `subplanner_contract`

## Scope note

These files define Atlas TypeScript vocabulary only. They do not register services, open sockets, poll SQLite, or implement bridge/runtime behavior.
