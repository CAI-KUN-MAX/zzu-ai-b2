import { ApiError, request } from "./http";

/**
 * 登录相关接口。后端尚未实现时这些请求会返回 404/501，
 * 这里不做任何 mock，让页面如实提示"服务暂未开放"。
 */

export interface AuthUser {
  id: string;
  username: string;
}

/** 用户名：4–20 位英文字母、数字或下划线，提交前按小写处理 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 后端返回 {"authenticated": bool, "user": {...} | null}，user 里的 username 才是真名 */
function pickUser(payload: { user?: { id?: unknown; username?: unknown } | null; authenticated?: boolean } | null): AuthUser | null {
  const username = payload?.user && typeof payload.user.username === "string" ? payload.user.username.trim() : "";
  const id = payload?.user && typeof payload.user.id === "string" ? payload.user.id.trim() : "";
  return username && id ? { id, username } : null;
}

/**
 * 返回 null 表示确实未登录；网络或服务异常一律抛出，交给页面重试。
 * 顺带：这一发 GET 会让后端下发 CSRF cookie，后续写请求才有令牌可用。
 */
export async function fetchMe(): Promise<AuthUser | null> {
  const data = await request<{ authenticated?: boolean; user?: { id?: unknown; username?: unknown } | null }>(
    "/api/auth/me",
    { method: "GET" }
  );
  if (data.authenticated === false && data.user === null) return null;
  const user = pickUser(data);
  if (data.authenticated !== true || !user) throw new ApiError("登录服务返回的数据不完整", "AUTH_BAD_RESPONSE");
  return user;
}

async function postAuth(path: string, payload: Record<string, unknown>): Promise<AuthUser> {
  const data = await request<{ user?: { id?: unknown; username?: unknown } | null }>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const user = pickUser(data);
  if (!user) {
    throw new ApiError("登录服务返回的数据不完整", "AUTH_BAD_RESPONSE");
  }
  return user;
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
