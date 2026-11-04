import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api/http";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  normalizeUsername,
  type AuthUser,
} from "../api/auth";
import { XIcon } from "./icons";

type Mode = "login" | "register";

interface AuthDialogProps {
  initialMode?: Mode;
  onLogin: (username: string, password: string) => Promise<AuthUser | null>;
  onRegister: (username: string, password: string) => Promise<AuthUser | null>;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

/** 后端错误码 → 用户能看懂的话；没匹配上的走兜底 */
function describeError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (err.status === null) return "网络好像不通，检查一下再试。";
    if (err.status === 401) return mode === "login" ? "用户名或密码不对。" : "注册后自动登录失败，请重试。";
    if (err.status === 409) return "这个用户名已经被占用了，换一个试试。";
    if (err.status === 422) return err.message || "用户名或密码不符合要求。";
    if (err.status === 429) return "尝试太频繁了，等一会儿再试。";
    if (err.status === 404 || err.status === 501) return "登录服务还没开放，目前可以继续以游客身份使用。";
    if (err.status >= 500) return "服务暂时不可用，稍后再试。";
    return err.message || `请求失败（HTTP ${err.status}）`;
  }
  return err instanceof Error ? err.message : "出了点问题，请重试。";
}

/**
 * 登录 / 注册弹窗。
 * 和 JD 弹窗一样挂到 body：外层玻璃外壳的 backdrop-filter 会让 fixed 失效。
 */
export function AuthDialog({
  initialMode = "login",
  onLogin,
  onRegister,
  onClose,
  onSuccess,
}: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    window.addEventListener("keydown", onKey);
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting]);

  function switchMode(next: Mode) {
    if (submitting) return;
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  }

  function validate(): string | null {
    const name = normalizeUsername(username);
    if (!name) return "请填写用户名。";
    if (!USERNAME_PATTERN.test(name)) return "用户名要 4–20 位，只能用字母、数字和下划线。";
    if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位。`;
    if (password.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位。`;
    if (mode === "register" && confirm !== password) return "两次输入的密码不一致。";
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const user =
        mode === "login"
          ? await onLogin(normalizeUsername(username), password)
          : await onRegister(normalizeUsername(username), password);
      if (user) onSuccess(user);
    } catch (err) {
      setError(describeError(err, mode));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="offer-dialog fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4 sm:p-6"
      onClick={() => !submitting && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "登录" : "注册"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-line px-5 py-4">
          <div>
            <p className="text-[11px] text-ink-500">Offer</p>
            <h2 className="mt-0.5 text-[17px] font-semibold text-ink-900">
              {mode === "login" ? "登录账号" : "注册新账号"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-surface-soft hover:text-ink-900 disabled:opacity-40"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "active" : ""}
                onClick={() => switchMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "active" : ""}
                onClick={() => switchMode("register")}
              >
                注册
              </button>
            </div>

            <label className="auth-field">
              <span>用户名</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="4–20 位字母、数字或下划线"
                disabled={submitting}
                maxLength={20}
              />
            </label>

            <label className="auth-field">
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`${PASSWORD_MIN}–${PASSWORD_MAX} 位，区分大小写`}
                disabled={submitting}
                maxLength={PASSWORD_MAX}
              />
            </label>

            {mode === "register" ? (
              <label className="auth-field">
                <span>确认密码</span>
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="再输一次，不会提交给服务器"
                  disabled={submitting}
                  maxLength={PASSWORD_MAX}
                />
              </label>
            ) : null}

            {error ? (
              <p className="auth-error" role="alert">{error}</p>
            ) : null}

            <p className="auth-note">
              {mode === "login"
                ? "登录前以游客身份产生的简历和匹配记录不会自动带入账号。"
                : "请妥善保存用户名和密码，当前版本暂不支持自助找回密码。"}
            </p>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-surface-line bg-white/90 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-surface-line bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-brand-300 disabled:opacity-40"
            >
              稍后再说
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
