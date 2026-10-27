import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/http";
import type { TaskStatus } from "../types";

/** 只要求带上任务状态，具体任务结构由调用方决定 */
interface TaskLike {
  status: TaskStatus;
  error?: string | null;
}

/** 退避节奏：1s → 2s → 3s 之后一直 3s */
const BACKOFF_MS = [1000, 2000, 3000];
/** 网络连续出错时的重试间隔，避免刷屏也避免放弃 */
const ERROR_RETRY_MS = 5000;
/** 硬超时，避免一直转圈 */
const MAX_DURATION_MS = 10 * 60 * 1000;
/** 连续失败这么多次才提示，避免网络抖动刷屏 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * 明确的业务错误（任务不存在、参数错误等）重试也没用，应停止轮询；
 * 网络异常、超时、限流和 5xx 只是暂时取不到状态，任务可能仍在后端正常运行。
 */
function isFatal(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status === null) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/**
 * 轮询一个异步任务。立即拉一次，拿到 succeeded / failed 立刻停。
 * 网络类错误不会让轮询停下：连续失败后给出提示，继续按间隔重试，恢复后提示自动消失。
 * 卸载或 taskId 变化时通过 AbortController 掐断在途请求。
 */
export function useTask<T extends TaskLike>(
  fetcher: (id: string, signal?: AbortSignal) => Promise<T>,
  taskId: string | null
): {
  data: T | null;
  error: string | null;
  /** error 是否为暂时性的（网络异常等），此时仍在自动重试 */
  transient: boolean;
  polling: boolean;
  /** 立即重新查询（例如用户点“重新获取”或已超过等待上限） */
  retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transient, setTransient] = useState(false);
  const [polling, setPolling] = useState(false);
  const [round, setRound] = useState(0);

  // fetcher 每次渲染可能是新函数，用 ref 存住，避免触发 effect 重跑
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const retry = useCallback(() => setRound((value) => value + 1), []);

  // 换任务时清空旧数据；同一任务的重试保留已有结果
  useEffect(() => {
    setData(null);
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setData(null);
      setError(null);
      setTransient(false);
      setPolling(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    let attempt = 0;
    let consecutiveErrors = 0;
    let timer: number | undefined;

    setError(null);
    setTransient(false);
    setPolling(true);

    const tick = async () => {
      if (cancelled) return;

      if (Date.now() - startedAt > MAX_DURATION_MS) {
        setError("等待时间较长，任务可能仍在后台进行，可点“重新获取”继续查看");
        setTransient(true);
        setPolling(false);
        return;
      }

      let delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      try {
        const result = await fetcherRef.current(taskId, controller.signal);
        if (cancelled) return;

        consecutiveErrors = 0;
        setData(result);
        setError(null);
        setTransient(false);

        if (result.status === "succeeded") {
          setPolling(false);
          return;
        }
        if (result.status === "failed") {
          setError(result.error ?? "任务失败，请重试");
          setPolling(false);
          return;
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;

        if (isFatal(err)) {
          setError(err instanceof ApiError ? err.message : "查询任务失败");
          setTransient(false);
          setPolling(false);
          return;
        }

        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          setError(err instanceof ApiError ? err.message : "网络异常，暂时无法获取任务状态");
          setTransient(true);
          delay = ERROR_RETRY_MS;
        }
      }

      attempt += 1;
      timer = window.setTimeout(tick, delay);
    };

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId, round]);

  return { data, error, transient, polling, retry };
}
