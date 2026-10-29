import type { IngestTask, ResumeStatus, ResumeText } from "../types";
import ingestMock from "../mock/ingest.json";
import { ApiError, IS_MOCK_MODE, UPLOAD_TIMEOUT_MS, request, wait } from "./http";

/** 单批最多 20 份 */
export const MAX_FILES = 20;
/** 单份最大 15MB */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;
/** 单批总量超过 50MB 时前端拆成多批串行上传 */
export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
/** 拆批时每批份数 */
export const BATCH_SIZE = 5;

/** 文档类：只走文档入口，不与图片混用 */
export const DOCUMENT_EXTENSIONS = [".pdf", ".docx"];
/** 图片类：只走图片入口 */
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

export const ACCEPTED_TYPES = [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS];

/**
 * 文档入口的 accept：扩展名 + 准确的 MIME。
 * 不能出现 image/*，否则部分移动端浏览器会直接跳到相册。
 */
export const DOCUMENT_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 图片入口的 accept：只接受位图，不给文档 */
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,image/png,image/jpeg";

export type FileKind = "document" | "image";

export function fileKindOf(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "document";
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  return null;
}

/** 上传前展示给用户的类型标签 */
export function fileTypeLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : "未知";
}

const MOCK_TASK: IngestTask = ingestMock as IngestTask;

/** mock 下记录每个任务的轮询次数，用来模拟进度推进 */
const mockPollCount = new Map<string, number>();
/** mock 下记录每个任务上传了几份，单份上传时不能返回 8 份样例 */
const mockFileCount = new Map<string, number>();

function mockIngestStep(taskId: string): IngestTask {
  const times = (mockPollCount.get(taskId) ?? 0) + 1;
  mockPollCount.set(taskId, times);

  const count = mockFileCount.get(taskId) ?? MOCK_TASK.items.length;
  const pool = MOCK_TASK.items.slice(0, Math.max(1, count));

  if (times === 1) {
    return {
      ...MOCK_TASK,
      status: "running",
      stage: `解析 ${Math.min(1, pool.length)}/${pool.length}`,
      progress: 20,
      items: pool.slice(0, 1),
    };
  }
  if (times === 2) {
    return {
      ...MOCK_TASK,
      status: count > 2 ? "running" : "succeeded",
      stage: `解析 ${Math.min(2, pool.length)}/${pool.length}`,
      progress: count > 2 ? 62 : 100,
      items: pool.slice(0, 2),
    };
  }
  return { ...MOCK_TASK, stage: `解析完成 ${pool.length}/${pool.length}`, items: pool };
}

/** POST /api/resumes/batch —— 一次提交整批文件 */
export async function uploadResumes(files: File[]): Promise<{ task_id: string }> {
  if (IS_MOCK_MODE) {
    await wait(1200);
    const taskId = `mock-ingest-${Date.now()}`;
    mockPollCount.set(taskId, 0);
    mockFileCount.set(taskId, files.length);
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

export interface UploadedBatch {
  taskId: string;
  count: number;
}

/**
 * 按 splitIntoBatches() 拆批后逐批串行上传，控制单次请求体积。
 * 后端是整批校验：某一批有不合格文件只拒绝这一批，其他批照常解析。
 */
export async function uploadInBatches(
  files: File[]
): Promise<{ batches: UploadedBatch[]; errors: string[] }> {
  const batches: UploadedBatch[] = [];
  const errors: string[] = [];
  const uploadGroup = async (group: File[]) => {
    try {
      const { task_id } = await uploadResumes(group);
      batches.push({ taskId: task_id, count: group.length });
    } catch (err) {
      // 后端整批校验：一份伪造扩展名或损坏的文件会让同批全部被拒。
      // 业务校验失败（4xx，非限流）时逐份重传，只让有问题的那份失败
      const status = err instanceof ApiError ? Number(err.status) : 0;
      if (group.length > 1 && status >= 400 && status < 500 && status !== 429) {
        for (const file of group) await uploadGroup([file]);
        return;
      }
      const names = group.map((file) => file.name).join("、");
      errors.push(`${names}：${err instanceof Error ? err.message : "上传失败"}`);
    }
  };

  for (const group of splitIntoBatches(files)) {
    await uploadGroup(group);
  }
  return { batches, errors };
}

/** 多个解析任务拼成一个 id 交给 useTask 轮询 */
export function joinTaskIds(batches: UploadedBatch[]): string {
  return batches.map((batch) => batch.taskId).join(",");
}

/**
 * 同时查询多个解析任务并合并：
 * - 任一批未结束就是 running；全部失败才算 failed；
 * - 进度按每批文件数加权；
 * - 同一份简历（相同内容）跨批出现时按 resume_id 去重。
 */
export async function getIngestTasks(
  batches: UploadedBatch[],
  signal?: AbortSignal
): Promise<IngestTask> {
  const tasks = await Promise.all(batches.map((batch) => getIngestTask(batch.taskId, signal)));
  if (tasks.length === 1) return tasks[0];

  const total = batches.reduce((sum, batch) => sum + batch.count, 0) || 1;
  const progress = Math.round(
    tasks.reduce((sum, task, index) => sum + task.progress * batches[index].count, 0) / total
  );
  const finished = tasks.every((task) => task.status === "succeeded" || task.status === "failed");
  const allFailed = tasks.every((task) => task.status === "failed");
  const doneBatches = tasks.filter((task) => task.status === "succeeded" || task.status === "failed").length;

  const seen = new Set<string>();
  const items = tasks
    .flatMap((task) => task.items)
    .filter((item) => (seen.has(item.resume_id) ? false : (seen.add(item.resume_id), true)));

  const firstFailed = tasks.find((task) => task.status === "failed");
  return {
    status: !finished ? "running" : allFailed ? "failed" : "succeeded",
    stage: !finished
      ? `共 ${tasks.length} 批，已完成 ${doneBatches} 批 · ${tasks.find((task) => task.status === "running")?.stage ?? "排队中"}`
      : allFailed
        ? "解析失败"
        : "解析完成",
    progress: finished ? 100 : progress,
    error: allFailed ? firstFailed?.error ?? "解析失败，请重新上传" : null,
    error_code: allFailed ? firstFailed?.error_code ?? null : null,
    items,
  };
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
    if (file.size === 0) {
      errors.push(`${file.name}：空文件`);
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
