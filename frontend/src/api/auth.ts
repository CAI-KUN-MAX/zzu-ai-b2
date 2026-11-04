import { ApiError, request } from "./http";

/**
 * 登录相关接口。后端尚未实现时这些请求会返回 404/501，
 * 这里不做任何 mock，让页面如实提示"服务暂未开放"。
 */

export interface AuthUser {
  username: string;
}

/** 用户名：4–20 位英文字母、数字或下划线，提交前按小写处理 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 返回 null 表示确实未登录；网络或服务异常一律抛出，交给页面重试 */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const data = await request<{ username?: string }>("/api/auth/me", { method: "GET" });
    const username = typeof data?.username === "string" ? data.username.trim() : "";
    return username ? { username } : null;
  } catch (err) {
    // 401/403 才是"没登录"，其他错误不能当成未登录
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

async function postAuth(path: string, payload: Record<string, unknown>): Promise<AuthUser> {
  const data = await request<{ username?: string }>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const username = typeof data?.username === "string" ? data.username.trim() : "";
  if (!username) {
    throw new ApiError("登录服务返回的数据不完整", "AUTH_BAD_RESPONSE");
  }
  return { username };
}

export function login(username: string, password: string): Promise<AuthUser> {
  return postAuth("/api/auth/login", { username: normalizeUsername(username), password });
}

export function register(username: string, password: string): Promise<AuthUser> {
  return postAuth("/api/auth/register", { username: normalizeUsername(username), password });
}

export async function logout(): Promise<void> {
  await request<unknown>("/api/auth/logout", { method: "POST" });
}
