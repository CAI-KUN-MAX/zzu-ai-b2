import { CheckIcon } from "./icons";

const STEPS = ["上传简历", "选择岗位", "查看排序", "诊断与面试"];

/**
 * 流程步骤条：替代「多标签导航」，让用户知道自己走到哪一步。
 * 主导航已收敛为单一入口，这里只表示流程进度，不可点击跳转。
 */
export function StepBar({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]" aria-label="流程进度">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;

        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors ${
                done
                  ? "bg-brand-600 text-white"
                  : active
                    ? "bg-brand-600 text-white ring-4 ring-brand-100"
                    : "bg-slate-100 text-ink-500"
              }`}
            >
              {done ? <CheckIcon className="h-3 w-3" /> : step}
            </span>
            <span
              className={
                active ? "font-semibold text-ink-900" : done ? "text-ink-700" : "text-ink-500"
              }
            >
              {label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="mx-1 text-ink-300" aria-hidden="true">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
