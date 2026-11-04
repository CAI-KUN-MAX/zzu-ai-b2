import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthUser,
} from "../api/auth";
import { ApiError } from "../api/http";
import { setStorageScope } from "./jobMatchStorage";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "error";

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** 仅 status === "error" 时有值：身份没确认下来，不能当成未登录 */
  error: string | null;
  /** 后端还没实现登录接口（404/501）：按未登录处理，但界面上要说明功能未开放 */
  unavailable: boolean;
}

/**
 * 全局身份状态。
 * me 请求失败时停在 error，不能默认按未登录处理 —— 否则会在网络抖动时把已登录用户踢回游客。
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    error: null,
    unavailable: false,
  });
  const submitting = useRef(false);

  const applyUser = useCallback((user: AuthUser | null) => {
    setStorageScope(user ? `user:${user.username}` : "guest");
    setState((prev) => ({
      status: user ? "authenticated" : "anonymous",
      user,
      error: null,
      unavailable: prev.unavailable,
    }));
  }, []);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      applyUser(await fetchMe());
    } catch (err) {
      // 后端还没做登录接口时，不能把游客卡在"身份确认失败"里
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        applyUser(null);
        setState((prev) => ({ ...prev, status: "anonymous", unavailable: true }));
        return;
      }
      setState({
        status: "error",
        user: null,
        error: err instanceof Error ? err.message : "暂时无法确认登录状态",
        unavailable: false,
      });
    }
  }, [applyUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      if (submitting.current) return null;
      submitting.current = true;
      try {
        const user = await apiLogin(username, password);
        applyUser(user);
        return user;
      } finally {
        submitting.current = false;
      }
    },
    [applyUser]
  );

  const register = useCallback(
    async (username: string, password: string) => {
      if (submitting.current) return null;
      submitting.current = true;
      try {
        const user = await apiRegister(username, password);
        applyUser(user);
        return user;
      } finally {
        submitting.current = false;
      }
    },
    [applyUser]
  );

  const logout = useCallback(async () => {
    if (submitting.current) return null;
    submitting.current = true;
    try {
      await apiLogout();
      applyUser(null);
      return true;
    } finally {
      submitting.current = false;
    }
  }, [applyUser]);

  return { ...state, refresh, login, register, logout };
}
