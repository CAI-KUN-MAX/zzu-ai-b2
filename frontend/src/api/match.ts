import type { MatchTask } from "../types";
import matchMock from "../mock/match.json";
import { API_BASE, IS_MOCK_MODE, request, wait } from "./http";

const MOCK_TASK: MatchTask = matchMock as MatchTask;

/** mock 下记录轮询次数，模拟打分进度推进 */
const mockPollCount = new Map<string, number>();

function mockMatchStep(taskId: string): MatchTask {
  const times = (mockPollCount.get(taskId) ?? 0) + 1;
  mockPollCount.set(taskId, times);

  if (times === 1) {
    return {
      ...MOCK_TASK,
      status: "running",
      stage: "打分 3/7",
      progress: 30,
      items: MOCK_TASK.items.slice(0, 3),
    };
  }
  if (times === 2) {
    return {
      ...MOCK_TASK,
      status: "running",
      stage: "生成匹配理由 5/7",
      progress: 75,
      items: MOCK_TASK.items.slice(0, 5),
    };
  }
  return MOCK_TASK;
}

/** POST /api/match —— 建任务，立即返回 task_id */
export async function createMatch(
  jdText: string,
  resumeIds: string[]
): Promise<{ task_id: string }> {
  if (IS_MOCK_MODE) {
    await wait(800);
    const taskId = `mock-match-${Date.now()}`;
    mockPollCount.set(taskId, 0);
    return { task_id: taskId };
  }

  return request<{ task_id: string }>("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jd_text: jdText, resume_ids: resumeIds }),
    timeoutMessage: "创建匹配任务超时，请稍后重试",
  });
}

/** GET /api/match/{task_id} */
export async function getMatchTask(taskId: string, signal?: AbortSignal): Promise<MatchTask> {
  if (IS_MOCK_MODE) {
    await wait(400);
    return mockMatchStep(taskId);
  }
  return request<MatchTask>(`/api/match/${encodeURIComponent(taskId)}`, { signal });
}

/** GET /api/match/{task_id}/export —— 导出 xlsx（P1） */
export function exportUrl(taskId: string): string {
  if (IS_MOCK_MODE) return "";
  return `${API_BASE}/api/match/${encodeURIComponent(taskId)}/export`;
}
