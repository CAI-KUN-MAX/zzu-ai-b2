import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/http";
import type { TaskStatus } from "../types";

/** 只要求带上任务状态，具体任务结构由调用方决定 */
interface TaskLike {
  status: TaskStatus;
  error?: string | null;
}

/** 退避节奏：1s → 2s → 3s 之后一直 3s */
const BACKOFF_MS = [1000, 2000, 3000];
/** 硬超时，避免一直转圈 */
const MAX_DURATION_MS = 10 * 60 * 1000;
/** 连续失败这么多次才提示，避免网络抖动刷屏 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * 轮询一个异步任务。立即拉一次，拿到 succeeded / failed 立刻停。
 * 卸载或 taskId 变化时通过 AbortController 掐断在途请求。
 */
export function useTask<T extends TaskLike>(
  fetcher: (id: string, signal?: AbortSignal) => Promise<T>,
  taskId: string | null
): { data: T | null; error: string | null; polling: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // fetcher 每次渲染可能是新函数，用 ref 存住，避免触发 effect 重跑
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!taskId) {
      setData(null);
      setError(null);
      setPolling(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    let attempt = 0;
    let consecutiveErrors = 0;
    let timer: number | undefined;

    setData(null);
    setError(null);
    setPolling(true);

    const tick = async () => {
      if (cancelled) return;

      if (Date.now() - startedAt > MAX_DURATION_MS) {
        setError("分析时间较长，可稍后刷新查看");
        setPolling(false);
        return;
      }

      try {
        const result = await fetcherRef.current(taskId, controller.signal);
        if (cancelled) return;

        consecutiveErrors = 0;
        setData(result);

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

        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          setError(err instanceof ApiError ? err.message : "轮询失败，请稍后重试");
          setPolling(false);
          return;
        }
      }

      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      timer = window.setTimeout(tick, delay);
    };

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId]);

  return { data, error, polling };
}
