import { useEffect, useState } from "react";
import { CheckIcon, SpinnerIcon } from "./icons";

/** 阶段划分：0-3s 解析简历，3-8s 匹配岗位，8s 之后深度诊断 */
const STAGES = [
  { label: "正在解析简历", from: 0 },
  { label: "正在匹配岗位要求", from: 3 },
  { label: "AI 正在深度诊断", from: 8 },
] as const;

export function LoadingPage() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = STAGES.reduce(
    (acc, stage, index) => (elapsed >= stage.from ? index : acc),
    0
  );
  const seconds = Math.floor(elapsed);

  return (
    <main className="mx-auto flex min-h-[72vh] max-w-3xl flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rise-in">
        <div className="flex flex-col items-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <SpinnerIcon className="h-8 w-8 animate-spin" />
          </span>

          <h2 className="mt-6 text-lg font-semibold tracking-tight">
            {STAGES[activeIndex].label}
          </h2>
          <p className="mt-2 text-[13px] text-ink-500">
            已等待 <span className="num font-medium text-ink-700">{seconds}</span> 秒 · 通常需要
            20-40 秒，请不要关闭页面
          </p>
        </div>

        {/* 不确定进度条，让用户确认页面没卡住 */}
        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="animate-indeterminate h-full w-1/3 rounded-full bg-brand-500" />
        </div>

        <ul className="mt-9 space-y-3.5">
          {STAGES.map((stage, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;

            return (
              <li key={stage.label} className="flex items-center gap-3">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-ink-300"
                  }`}
                >
                  {done ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        active ? "animate-pulse bg-white" : "bg-ink-300"
                      }`}
                    />
                  )}
                </span>

                <span
                  className={`text-[13px] ${
                    active ? "font-medium text-ink-900" : done ? "text-ink-500" : "text-ink-300"
                  }`}
                >
                  {stage.label}
                </span>

                {active ? (
                  <span className="ml-auto text-[11px] text-brand-600">进行中</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <p className="mt-10 text-center text-[11px] leading-relaxed text-ink-500">
          正在调用大模型生成完整报告，期间请不要刷新或关闭页面。
        </p>
      </div>
    </main>
  );
}
