import type {
  DiagnoseResponse,
  Job,
  JobList,
  JobMatchItem,
  JobMatchTask,
  MatchContext,
} from "../types";
import jobsMock from "../mock/jobs.json";
import { IS_MOCK_MODE, request, wait } from "./http";

interface MockScore {
  stage1: number;
  final: number;
  level: "high" | "medium" | "low";
  level_label: string;
  matched: string[];
  missing: string[];
  reason: string;
}

const MOCK_JOBS = jobsMock.jobs as Job[];
const MOCK_SCORES = jobsMock.scores as Record<string, MockScore>;
const MOCK_REPORTS = jobsMock.reports as Record<string, DiagnoseResponse>;
const MOCK_VERSION = jobsMock.catalogue_version as string;

/** mock 下记录每个任务选中的岗位与轮询次数 */
const mockSelected = new Map<string, string[]>();
const mockPoll = new Map<string, number>();

export interface ListJobsParams {
  category?: string;
  education?: string;
  page?: number;
  page_size?: number;
}

/** GET /api/jobs —— 岗位目录（分页 + 类别/学历筛选） */
export async function listJobs(
  params: ListJobsParams = {},
  signal?: AbortSignal
): Promise<JobList> {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 20;

  if (IS_MOCK_MODE) {
    await wait(400);
    const filtered = MOCK_JOBS.filter(
      (job) =>
        (!params.category || job.category === params.category) &&
        (!params.education || job.education === params.education)
    );
    const start = (page - 1) * pageSize;
    return {
      catalogue_version: MOCK_VERSION,
      total: filtered.length,
      page,
      page_size: pageSize,
      items: filtered.slice(start, start + pageSize),
    };
  }

  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (params.category) query.set("category", params.category);
  if (params.education) query.set("education", params.education);

  return request<JobList>(`/api/jobs?${query.toString()}`, { signal });
}

function buildMockItem(jobId: string, withReport: boolean): JobMatchItem {
  const score = MOCK_SCORES[jobId];
  const job = MOCK_JOBS.find((item) => item.job_id === jobId);
  const report = withReport ? MOCK_REPORTS[jobId] ?? null : null;

  return {
    job_id: jobId,
    title: job?.title ?? "未知岗位",
    score: score?.final ?? 60,
    stage1_score: score?.stage1 ?? 60,
    level: score?.level ?? "medium",
    level_label: score?.level_label ?? "较匹配",
    subscores: [
      { key: "skill_match", label: "技能关键词", score: Math.round((score?.stage1 ?? 60) * 0.95), weight: 0.55 },
      { key: "text_similarity", label: "文本相似度", score: Math.round((score?.stage1 ?? 60) * 0.9), weight: 0.3 },
      { key: "education_match", label: "学历匹配", score: 90, weight: 0.15 },
    ],
    matched: score?.matched ?? [],
    missing: score?.missing ?? [],
    reason: score?.reason ?? null,
    degraded: !report,
    degraded_reason: report ? null : "not_selected",
    analysis_status: report ? "succeeded" : "degraded",
    report,
  };
}

function mockStep(taskId: string): JobMatchTask {
  const jobIds = mockSelected.get(taskId) ?? [];
  const times = (mockPoll.get(taskId) ?? 0) + 1;
  mockPoll.set(taskId, times);

  const total = jobIds.length;
  if (times === 1) {
    return {
      status: "running",
      stage: `基础评分 ${Math.min(2, total)}/${total}`,
      progress: 35,
      error: null,
      error_code: null,
      items: jobIds.slice(0, 2).map((id) => buildMockItem(id, false)),
    };
  }
  if (times === 2) {
    return {
      status: "running",
      stage: `生成推荐理由 ${Math.min(3, total)}/${total}`,
      progress: 78,
      error: null,
      error_code: null,
      items: jobIds.slice(0, 3).map((id, index) => buildMockItem(id, index < 2)),
    };
  }

  return {
    status: "succeeded",
    stage: `匹配完成 ${total}/${total}`,
    progress: 100,
    error: null,
    error_code: null,
    // 前两个岗位给完整报告，其余降级，用来演示两种展示形态
    items: jobIds
      .map((id, index) => buildMockItem(id, index < 2))
      .sort((a, b) => b.score - a.score),
  };
}

/** POST /api/job-matches —— 只传 job_ids，JD 由后端按目录补全 */
export async function createJobMatch(
  resumeId: string,
  jobIds: string[]
): Promise<{ task_id: string }> {
  if (IS_MOCK_MODE) {
    await wait(900);
    const taskId = `mock-job-${Date.now()}`;
    mockSelected.set(taskId, jobIds);
    mockPoll.set(taskId, 0);
    return { task_id: taskId };
  }

  return request<{ task_id: string }>("/api/job-matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_id: resumeId, job_ids: jobIds }),
    timeoutMessage: "创建岗位匹配任务超时，请稍后重试",
  });
}

/** GET /api/job-matches/{task_id} */
export async function getJobMatchTask(
  taskId: string,
  signal?: AbortSignal
): Promise<JobMatchTask> {
  if (IS_MOCK_MODE) {
    await wait(400);
    return mockStep(taskId);
  }
  return request<JobMatchTask>(`/api/job-matches/${encodeURIComponent(taskId)}`, { signal });
}

/** GET /api/job-matches/{task_id}/items/{job_id}/context —— 诊断与面试的上下文 */
export async function getMatchContext(
  taskId: string,
  jobId: string,
  signal?: AbortSignal
): Promise<MatchContext> {
  if (IS_MOCK_MODE) {
    await wait(300);
    const job = MOCK_JOBS.find((item) => item.job_id === jobId);
    const resumeId = "mock-resume";
    return {
      resume_id: resumeId,
      job_id: jobId,
      diagnose_request: { resume_text: "（mock 简历文本）", jd_text: job?.jd_text ?? "" },
      interview_request: { resume_id: resumeId, jd_text: job?.jd_text ?? "" },
    };
  }

  return request<MatchContext>(
    `/api/job-matches/${encodeURIComponent(taskId)}/items/${encodeURIComponent(jobId)}/context`,
    { signal }
  );
}
