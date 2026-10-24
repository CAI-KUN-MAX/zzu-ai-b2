import type { IngestTask, ResumeStatus, ResumeText } from "../types";
import ingestMock from "../mock/ingest.json";
import { IS_MOCK_MODE, UPLOAD_TIMEOUT_MS, request, wait } from "./http";

/** 单批最多 20 份 */
export const MAX_FILES = 20;
/** 单份最大 15MB */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;
/** 单批总量超过 50MB 时前端拆成多批串行上传 */
export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
/** 拆批时每批份数 */
export const BATCH_SIZE = 5;

export const ACCEPTED_TYPES = [".pdf", ".docx", ".png", ".jpg", ".jpeg"];

const MOCK_TASK: IngestTask = ingestMock as IngestTask;

/** mock 下记录每个任务的轮询次数，用来模拟进度推进 */
const mockPollCount = new Map<string, number>();

function mockIngestStep(taskId: string): IngestTask {
  const times = (mockPollCount.get(taskId) ?? 0) + 1;
  mockPollCount.set(taskId, times);

  if (times === 1) {
    return {
      ...MOCK_TASK,
      status: "running",
      stage: "解析 2/8",
      progress: 20,
      items: MOCK_TASK.items.slice(0, 2),
    };
  }
  if (times === 2) {
    return {
      ...MOCK_TASK,
      status: "running",
      stage: "解析 5/8",
      progress: 62,
      items: MOCK_TASK.items.slice(0, 5),
    };
  }
  return MOCK_TASK;
}

/** POST /api/resumes/batch —— 一次提交整批文件 */
export async function uploadResumes(files: File[]): Promise<{ task_id: string }> {
  if (IS_MOCK_MODE) {
    await wait(1200);
    const taskId = `mock-ingest-${Date.now()}`;
    mockPollCount.set(taskId, 0);
    return { task_id: taskId };
  }

  const form = new FormData();
  files.forEach((file) => form.append("files", file));

  // 关键：绝对不能手动设 Content-Type，否则 multipart 边界写死，上传必失败
  return request<{ task_id: string }>("/api/resumes/batch", {
    method: "POST",
    body: form,
    timeout: UPLOAD_TIMEOUT_MS,
    timeoutMessage: "上传超时，请检查网络后重试",
  });
}

/** GET /api/tasks/{task_id} */
export async function getIngestTask(taskId: string, signal?: AbortSignal): Promise<IngestTask> {
  if (IS_MOCK_MODE) {
    await wait(300);
    return mockIngestStep(taskId);
  }
  return request<IngestTask>(`/api/tasks/${encodeURIComponent(taskId)}`, { signal });
}

/** GET /api/resumes/{resume_id}/text */
export async function getResumeText(
  resumeId: string,
  signal?: AbortSignal
): Promise<ResumeText> {
  if (IS_MOCK_MODE) {
    await wait(200);
    const item = MOCK_TASK.items.find((it) => it.resume_id === resumeId);
    const body = item?.preview ?? "";
    return {
      resume_id: resumeId,
      name: item?.name ?? "未知简历",
      chars: item?.chars ?? body.length,
      // mock 里只有预览，拼几段让展开视图有内容可看
      text:
        item?.status === "failed"
          ? body
          : `${body}\n\n【教育经历】\n郑州大学 计算机科学与技术 本科 2023.09 - 2027.06\n\n【项目经历】\n负责前端页面搭建与接口联调，使用 TypeScript 完成类型定义，\n配合后端完成契约对齐，页面在移动端与桌面端均可用。\n\n【技能】\nReact / TypeScript / Tailwind CSS / Git`,
    };
  }
  return request<ResumeText>(`/api/resumes/${encodeURIComponent(resumeId)}/text`, { signal });
}

/** 按扩展名与大小做前端预校验，返回每条失败原因 */
export function validateFiles(files: File[]): { ok: File[]; errors: string[] } {
  const ok: File[] = [];
  const errors: string[] = [];

  files.forEach((file) => {
    const lower = file.name.toLowerCase();
    const matched = ACCEPTED_TYPES.some((ext) => lower.endsWith(ext));
    if (!matched) {
      errors.push(`${file.name}：仅支持 PDF / DOCX / PNG / JPG`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}：超过 15MB`);
      return;
    }
    ok.push(file);
  });

  return { ok, errors };
}

/** 按 50MB 上限把文件切成多批，保证单批不超过限制 */
export function splitIntoBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;

  files.forEach((file) => {
    const wouldExceedBytes = currentBytes + file.size > MAX_BATCH_BYTES;
    const wouldExceedCount = current.length >= BATCH_SIZE;

    if (current.length > 0 && (wouldExceedBytes || wouldExceedCount)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}

export const STATUS_LABEL: Record<ResumeStatus, string> = {
  ready: "解析完成",
  need_review: "建议核对",
  failed: "解析失败",
};
