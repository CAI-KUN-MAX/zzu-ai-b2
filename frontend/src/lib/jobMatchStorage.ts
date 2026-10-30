import type { Job, ResumeStatus } from "../types";

/**
 * 岗位匹配的本地记录：刷新页面或误点返回后还能找回上一次的任务。
 * 只存在当前浏览器的 localStorage，不改后端；读写失败（隐私模式等）时当作没有记录。
 */
export interface StoredJobMatch {
  /** 结构版本：字段变化时自增，旧数据一律判废，避免半旧半新导致白屏 */
  version: number;
  taskId: string;
  resumeId: string;
  resumeName: string;
  resumeStatus: ResumeStatus;
  jobIds: string[];
  /** 只存参与匹配的岗位，避免把整份目录写进本地 */
  jobIndex: Record<string, Job>;
  savedAt: number;
}

export interface StoredDraft {
  resumeTaskId: string | null;
  selected: string[];
}

const LAST_KEY = "zzu.jobMatch.last";
const DRAFT_KEY = "zzu.jobMatch.draft";
const STORAGE_VERSION = 1;
/** 后端任务记录不会无限保留，超过一天的记录不再提示恢复 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 允许的时钟偏差，超过这个「未来时间」视为脏数据 */
const CLOCK_SKEW_MS = 60 * 1000;

const RESUME_STATUSES: ResumeStatus[] = ["ready", "need_review", "failed"];

/**
 * 区分「没有记录」和「有记录但解析失败」：
 * 后者必须被清理，否则坏数据会一直留在本地，每次进来都要解析一次。
 */
function readRaw(key: string): { exists: boolean; value: unknown } {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { exists: false, value: null };
    return { exists: true, value: JSON.parse(raw) };
  } catch {
    return { exists: true, value: null };
  }
}

function read<T>(key: string): T | null {
  const { value } = readRaw(key);
  return (value ?? null) as T | null;
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只在内存里保留，不影响主流程
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 只校验渲染和请求真正用到的字段，避免把整份 Job 契约复制一遍 */
function isValidJob(value: unknown, expectedId: string): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return (
    job.job_id === expectedId &&
    isNonEmptyString(job.title) &&
    typeof job.company === "string" &&
    Array.isArray(job.cities) &&
    typeof job.jd_text === "string"
  );
}

/**
 * 严格解析本地记录。任何一项不合法都返回 null，由调用方清理并回到可操作页面，
 * 避免拿着坏 taskId / 坏 jobId 去发请求。
 */
export function parseStoredJobMatch(value: unknown): StoredJobMatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;

  if (item.version !== STORAGE_VERSION) return null;
  if (!isNonEmptyString(item.taskId)) return null;
  if (!isNonEmptyString(item.resumeId)) return null;
  if (typeof item.resumeName !== "string") return null;
  if (!RESUME_STATUSES.includes(item.resumeStatus as ResumeStatus)) return null;
  if (!Array.isArray(item.jobIds) || item.jobIds.length === 0) return null;
  if (!item.jobIds.every((id) => isNonEmptyString(id))) return null;
  if (typeof item.savedAt !== "number" || !Number.isFinite(item.savedAt)) return null;

  const savedAt = item.savedAt;
  // 未来时间（时钟回拨或被手改）直接判废
  if (savedAt > Date.now() + CLOCK_SKEW_MS) return null;
  if (Date.now() - savedAt > MAX_AGE_MS) return null;

  if (!item.jobIndex || typeof item.jobIndex !== "object" || Array.isArray(item.jobIndex)) {
    return null;
  }
  const rawIndex = item.jobIndex as Record<string, unknown>;
  const jobIds = item.jobIds as string[];
  const jobIndex: Record<string, Job> = {};

  for (const jobId of jobIds) {
    const job = rawIndex[jobId];
    if (!isValidJob(job, jobId)) return null;
    jobIndex[jobId] = job;
  }

  return {
    version: STORAGE_VERSION,
    taskId: item.taskId,
    resumeId: item.resumeId,
    resumeName: item.resumeName,
    resumeStatus: item.resumeStatus as ResumeStatus,
    jobIds,
    jobIndex,
    savedAt,
  };
}

/** 读取上一次的匹配任务；数据不合法就顺手清掉，不留脏记录 */
export function loadLastMatch(): StoredJobMatch | null {
  const { exists, value } = readRaw(LAST_KEY);
  const parsed = parseStoredJobMatch(value);
  if (!parsed) {
    // 有记录但不合法（含 JSON 解析失败）就清掉，不留脏数据
    if (exists) write(LAST_KEY, null);
    return null;
  }
  return parsed;
}

export function saveLastMatch(value: Omit<StoredJobMatch, "version"> | null) {
  write(LAST_KEY, value === null ? null : { ...value, version: STORAGE_VERSION });
}

export function loadDraft(): StoredDraft {
  const value = read<StoredDraft>(DRAFT_KEY);
  return {
    resumeTaskId: isNonEmptyString(value?.resumeTaskId) ? value.resumeTaskId : null,
    selected: Array.isArray(value?.selected)
      ? value.selected.filter((id): id is string => isNonEmptyString(id))
      : [],
  };
}

export function saveDraft(value: StoredDraft) {
  write(DRAFT_KEY, value);
}

export function clearLastMatch() {
  write(LAST_KEY, null);
}
