import type { Job, ResumeStatus } from "../types";

/**
 * 岗位匹配的本地记录：刷新页面或误点返回后还能找回上一次的任务。
 * 只存在当前浏览器的 localStorage，不改后端；读写失败（隐私模式等）时当作没有记录。
 */
export interface StoredJobMatch {
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
/** 后端任务记录不会无限保留，超过一天的记录不再提示恢复 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只在内存里保留，不影响主流程
  }
}

export function loadLastMatch(): StoredJobMatch | null {
  const value = read<StoredJobMatch>(LAST_KEY);
  if (!value || typeof value.taskId !== "string" || !Array.isArray(value.jobIds)) return null;
  if (Date.now() - value.savedAt > MAX_AGE_MS) {
    write(LAST_KEY, null);
    return null;
  }
  return value;
}

export function saveLastMatch(value: StoredJobMatch | null) {
  write(LAST_KEY, value);
}

export function loadDraft(): StoredDraft {
  const value = read<StoredDraft>(DRAFT_KEY);
  return {
    resumeTaskId: typeof value?.resumeTaskId === "string" ? value.resumeTaskId : null,
    selected: Array.isArray(value?.selected) ? value.selected.filter((id) => typeof id === "string") : [],
  };
}

export function saveDraft(value: StoredDraft) {
  write(DRAFT_KEY, value);
}
