import { client } from '#/gen/ov-client/client.gen'
import { getOvResult, getTasks } from '#/lib/ov-client'
import {
  normalizeTasks,
  normalizeTaskStatus,
} from '#/routes/tasks/-lib/task-record'
import type { TaskRecord, TaskStatus } from '#/routes/tasks/-lib/task-record'

export type TaskStatusFilter = Exclude<TaskStatus, 'unknown'> | 'all'

export type TaskTypeFilter =
  | 'add_resource'
  | 'add_skill'
  | 'admin_reindex'
  | 'connector_import'
  | 'legacy_cleanup'
  | 'legacy_migration'
  | 'session_commit'
  | 'snapshot_restore_reindex'
  | 'all'

export const MAX_TASKS = 200

export type TaskSummary = {
  window_seconds: number
  completed: number
  failed: number
  success_rate: number | null
}

/** Prefer the API status; do not invent pending from a running-slot cap. */
export function getEffectiveTaskStatus(
  taskItem: TaskRecord,
  _list?: TaskRecord[],
): TaskStatus {
  return normalizeTaskStatus(taskItem.status)
}

export async function fetchTasks(
  taskType: TaskTypeFilter,
  status: TaskStatusFilter,
): Promise<TaskRecord[]> {
  const result = await getOvResult<unknown>(
    getTasks({
      query: {
        limit: MAX_TASKS,
        ...(taskType === 'all' ? {} : { task_type: taskType }),
        ...(status === 'all' ? {} : { status }),
      },
    }),
  )
  return normalizeTasks(result).sort(
    (left, right) =>
      Number(right.created_at || 0) - Number(left.created_at || 0),
  )
}

export async function fetchTaskSummary(): Promise<TaskSummary> {
  const result = await getOvResult<TaskSummary>(
    client.get({
      url: '/api/v1/tasks/summary',
    }),
  )
  return {
    window_seconds: Number(result.window_seconds) || 86_400,
    completed: Number(result.completed) || 0,
    failed: Number(result.failed) || 0,
    success_rate:
      result.success_rate === null || result.success_rate === undefined
        ? null
        : Number(result.success_rate),
  }
}
