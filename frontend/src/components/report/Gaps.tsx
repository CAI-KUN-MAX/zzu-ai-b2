import type { Gap } from "../../types";
import { severityMeta } from "../../lib/theme";
import { AlertIcon } from "../icons";

interface GapsProps {
  gaps: Gap[];
  className?: string;
}

/** 待补齐项 —— 结果页与简历筛选的行内详情共用 */
export function Gaps({ gaps, className = "mt-10" }: GapsProps) {
  return (
    <section className={className}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-50 text-amber-600">
          <AlertIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">待补齐项</h2>
        <span className="num rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {gaps.length}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">
        按优先级排序，高优先级项建议在投递前优先修改。
      </p>

      <div className="mt-3 space-y-4">
        {gaps.map((gap, index) => {
          const severity = severityMeta(gap.severity);
          // include_suggestions=false 时后端会返回空字符串，此时不渲染建议列
          const hasSuggestion = Boolean(gap.suggestion?.trim());
          return (
            <article
              key={`${gap.title}-${index}`}
              className="rise-in relative overflow-hidden rounded-2xl border border-surface-line bg-white p-5 pl-6 shadow-card"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <span
                className={`absolute bottom-5 left-0 top-5 w-[3px] rounded-r-full ${severity.dot}`}
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[14px] font-semibold leading-snug">{gap.title}</h3>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${severity.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${severity.dot}`} />
                  {severity.label}
                </span>
              </div>

              <div
                className={`mt-4 grid gap-4 ${hasSuggestion ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
              >
                <div>
                  <p className="text-[11px] font-medium text-ink-500">JD 要求</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                    {gap.jd_requirement || "未提及"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-ink-500">简历现状</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                    {gap.resume_evidence || "未体现"}
                  </p>
                </div>
                {hasSuggestion ? (
                  <div className="rounded-xl bg-brand-50/70 p-3">
                    <p className="text-[11px] font-medium text-brand-700">改进建议</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-700">{gap.suggestion}</p>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {gaps.length === 0 ? (
          <p className="rounded-2xl border border-surface-line bg-white px-5 py-6 text-sm text-ink-500">
            未发现明显缺口，简历与岗位要求基本对齐。
          </p>
        ) : null}
      </div>
    </section>
  );
}
