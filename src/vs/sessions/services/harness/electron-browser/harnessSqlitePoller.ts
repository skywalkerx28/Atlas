/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- Wave A fallback reuses the repo-native SQLite dependency without introducing a new package.
import type { Database } from '@vscode/sqlite3';
import { Queue, IntervalTimer } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IHarnessFleetStateSnapshot } from '../common/harnessTypes.js';
import { createEmptyFleetSnapshotState, toBridgeHealthSnapshot, toBridgeQueueSnapshot, toBridgeWorkerRecord } from './harnessMapper.js';

const ACTIVE_WORKER_STATES = ['queued', 'spawning', 'ready', 'executing', 'paused', 'completing'] as const;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
// eslint-disable-next-line local/code-no-unexternalized-strings -- SQL query for read-only harness queue depth polling.
const SQL_COUNT_QUEUED_DISPATCHES = "SELECT COUNT(*) AS count FROM dispatch_queue WHERE status = 'queued'";
// eslint-disable-next-line local/code-no-unexternalized-strings -- SQL query for read-only harness merge queue polling.
const SQL_COUNT_PENDING_MERGES = "SELECT COUNT(*) AS count FROM merge_queue WHERE status = 'pending'";
// eslint-disable-next-line local/code-no-unexternalized-strings -- SQL query for read-only harness merge conflict polling.
const SQL_COUNT_MERGE_CONFLICTS = "SELECT COUNT(*) AS count FROM merge_queue WHERE status = 'merge_blocked'";
// eslint-disable-next-line local/code-no-unexternalized-strings -- SQL query for read-only workspace event polling.
const SQL_COUNT_PENDING_WORKSPACE_EVENTS = "SELECT COUNT(*) AS count FROM workspace_event_queue WHERE status = 'pending'";

interface IWorkerRow {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly state: string;
	readonly worktree_path: string | null;
	readonly pid: number | null;
	readonly handoff_type: string | null;
	readonly started_at: string;
	readonly last_heartbeat_at: string;
}

interface IHealthRow {
	readonly mode: string;
	readonly disk_usage_pct: number;
	readonly memory_usage_pct: number;
	readonly wal_size_bytes: number;
	readonly last_health_check: string;
}

export class HarnessSqlitePoller extends Disposable {

	private readonly refreshQueue = new Queue();
	private readonly intervalTimer = this._register(new IntervalTimer());
	private readonly _onDidSnapshot = this._register(new Emitter<IHarnessFleetStateSnapshot>());
	readonly onDidSnapshot: Event<IHarnessFleetStateSnapshot> = this._onDidSnapshot.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private connection: Database | undefined;
	private existingTables: ReadonlySet<string> | undefined;

	constructor(
		private readonly dbPath: string,
		private readonly logService: ILogService,
		private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
	) {
		super();
	}

	async start(): Promise<IHarnessFleetStateSnapshot> {
		const snapshot = await this.readSnapshot();
		this._onDidSnapshot.fire(snapshot);
		this.intervalTimer.cancelAndSet(() => {
			void this.refreshQueue.queue(async () => {
				try {
					const nextSnapshot = await this.readSnapshot();
					this._onDidSnapshot.fire(nextSnapshot);
				} catch (error) {
					const resolved = asError(error);
					this.intervalTimer.cancel();
					this.logService.error(`Harness SQLite poller failed closed for ${this.dbPath}: ${resolved.message}`);
					this._onDidError.fire(resolved);
				}
			});
		}, this.pollIntervalMs);
		return snapshot;
	}

	async stop(): Promise<void> {
		this.intervalTimer.cancel();
		await this.closeConnection();
	}

	override dispose(): void {
		void this.stop();
		super.dispose();
	}

	private async readSnapshot(): Promise<IHarnessFleetStateSnapshot> {
		const db = await this.ensureConnection();
		const tables = await this.ensureTablePresence(db);
		if (!tables.has('worker_registry')) {
			throw new Error(`Harness router db is missing required table 'worker_registry': ${this.dbPath}`);
		}

		const [workers, activeWorkers, dispatchQueueDepth, mergeQueueDepth, mergeConflicts, pendingWorkspaceEvents, healthRow] = await Promise.all([
			this.readWorkers(db, tables),
			this.readActiveWorkerCount(db),
			this.countIfTable(db, tables, 'dispatch_queue', SQL_COUNT_QUEUED_DISPATCHES),
			this.countIfTable(db, tables, 'merge_queue', SQL_COUNT_PENDING_MERGES),
			this.countIfTable(db, tables, 'merge_queue', SQL_COUNT_MERGE_CONFLICTS),
			this.countIfTable(db, tables, 'workspace_event_queue', SQL_COUNT_PENDING_WORKSPACE_EVENTS),
			this.readHealthRow(db, tables),
		]);

		const capturedAt = Date.now();
		const queue = toBridgeQueueSnapshot({
			dispatchQueueDepth,
			mergeQueueDepth,
			mergeConflicts,
			pendingWorkspaceEvents,
		});

		const health = toBridgeHealthSnapshot(
			healthRow ? {
				mode: healthRow.mode,
				diskUsagePct: healthRow.disk_usage_pct,
				memoryUsagePct: healthRow.memory_usage_pct,
				walSizeBytes: Math.max(0, healthRow.wal_size_bytes),
				activeWorkers,
				queueDepth: dispatchQueueDepth,
				lastHealthCheck: healthRow.last_health_check,
			} : {
				mode: 'unknown',
				diskUsagePct: 0,
				memoryUsagePct: 0,
				walSizeBytes: 0,
				activeWorkers,
				queueDepth: dispatchQueueDepth,
				lastHealthCheck: undefined,
			}
		);

		return {
			...createEmptyFleetSnapshotState(),
			capturedAt,
			workers,
			queue,
			health,
		};
	}

	private async readWorkers(db: Database, tables: ReadonlySet<string>): Promise<readonly ReturnType<typeof toBridgeWorkerRecord>[]> {
		const sql = tables.has('dispatch_queue')
			? `SELECT w.dispatch_id, w.task_id, w.role_id, w.state, w.worktree_path, w.pid, q.handoff_type, w.started_at, w.last_heartbeat_at
				FROM worker_registry w
				LEFT JOIN dispatch_queue q ON q.dispatch_id = w.dispatch_id
				ORDER BY w.started_at ASC`
			: `SELECT w.dispatch_id, w.task_id, w.role_id, w.state, w.worktree_path, w.pid, NULL AS handoff_type, w.started_at, w.last_heartbeat_at
				FROM worker_registry w
				ORDER BY w.started_at ASC`;
		const rows = await this.all<IWorkerRow>(db, sql);
		return Object.freeze(rows.map(row => toBridgeWorkerRecord({
			dispatchId: row.dispatch_id,
			taskId: row.task_id,
			roleId: row.role_id,
			state: normalizeWorkerState(row.state),
			handoffType: normalizeHandoffType(row.handoff_type),
			pid: row.pid ?? undefined,
			asi: undefined,
			startedAt: row.started_at,
			lastHeartbeatAt: row.last_heartbeat_at,
			worktreePath: row.worktree_path ?? undefined,
		})));
	}

	private async readActiveWorkerCount(db: Database): Promise<number> {
		const placeholders = ACTIVE_WORKER_STATES.map(() => '?').join(', ');
		const row = await this.get<{ readonly count: number }>(
			db,
			`SELECT COUNT(*) AS count FROM worker_registry WHERE state IN (${placeholders})`,
			[...ACTIVE_WORKER_STATES],
		);
		return row?.count ?? 0;
	}

	private async readHealthRow(db: Database, tables: ReadonlySet<string>): Promise<IHealthRow | undefined> {
		if (!tables.has('pool_health')) {
			return undefined;
		}
		return this.get<IHealthRow>(
			db,
			`SELECT mode, disk_usage_pct, memory_usage_pct, wal_size_bytes, last_health_check
				FROM pool_health
				WHERE id = 1`,
		);
	}

	private async countIfTable(
		db: Database,
		tables: ReadonlySet<string>,
		tableName: string,
		sql: string,
	): Promise<number> {
		if (!tables.has(tableName)) {
			return 0;
		}
		const row = await this.get<{ readonly count: number }>(db, sql);
		return row?.count ?? 0;
	}

	private async ensureConnection(): Promise<Database> {
		if (this.connection) {
			return this.connection;
		}

		const sqlite3 = (await import('@vscode/sqlite3')).default;
		this.connection = await new Promise<Database>((resolve, reject) => {
			const connection = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, error => {
				if (error) {
					reject(error);
					return;
				}
				resolve(connection);
			});
		});

		return this.connection;
	}

	private async ensureTablePresence(db: Database): Promise<ReadonlySet<string>> {
		if (this.existingTables) {
			return this.existingTables;
		}

		const rows = await this.all<{ readonly name: string }>(
			db,
			`SELECT name FROM sqlite_master WHERE type = 'table'`,
		);
		this.existingTables = new Set(rows.map(row => row.name));
		return this.existingTables;
	}

	private async closeConnection(): Promise<void> {
		const connection = this.connection;
		this.connection = undefined;
		this.existingTables = undefined;
		if (!connection) {
			return;
		}

		await new Promise<void>((resolve, reject) => {
			connection.close(error => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	private async all<T>(db: Database, sql: string, params: readonly unknown[] = []): Promise<readonly T[]> {
		return new Promise<readonly T[]>((resolve, reject) => {
			db.all(sql, [...params], (error, rows) => {
				if (error) {
					reject(error);
					return;
				}
				resolve((rows ?? []) as readonly T[]);
			});
		});
	}

	private async get<T>(db: Database, sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
		return new Promise<T | undefined>((resolve, reject) => {
			db.get(sql, [...params], (error, row) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(row as T | undefined);
			});
		});
	}
}

function normalizeWorkerState(value: string): ReturnType<typeof toBridgeWorkerRecord>['state'] {
	switch (value) {
		case 'queued':
		case 'spawning':
		case 'ready':
		case 'executing':
		case 'paused':
		case 'completing':
		case 'completed':
		case 'failed':
		case 'timed_out':
		case 'killed':
			return value;
		default:
			return 'failed';
	}
}

function normalizeHandoffType(value: string | null): ReturnType<typeof toBridgeWorkerRecord>['handoffType'] {
	switch (value) {
		case 'intake':
		case 'planning':
		case 'specification':
		case 'implementation':
		case 'verification':
		case 'review':
		case 'clarification':
			return value;
		default:
			return undefined;
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
