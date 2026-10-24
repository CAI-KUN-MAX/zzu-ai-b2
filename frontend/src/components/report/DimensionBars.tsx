import type { DimensionScore } from "../../types";
import { scoreTone } from "../../lib/theme";

interface DimensionBarsProps {
  dimensions: DimensionScore[];
  title?: string;
  hint?: string;
  className?: string;
}

/** 维度得分条 —— 结果页与简历筛选的行内详情共用 */
export function DimensionBars({
  dimensions,
  title = "维度得分",
  hint = "四项加权得出总分",
  className = "mt-6",
}: DimensionBarsProps) {
  return (
    <section className={`${className} rounded-xl2 border border-surface-line bg-white p-6 shadow-card`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-[11px] text-ink-500">{hint}</span>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {dimensions.map((dimension) => {
          const tone = scoreTone(dimension.score);
          return (
            <div key={dimension.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] text-ink-700">
                  {dimension.label}
                  <span className="ml-2 text-[11px] text-ink-500">
                    权重 {Math.round(dimension.weight * 100)}%
                  </span>
                </span>
                <span className={`num text-sm font-semibold ${tone.text}`}>{dimension.score}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                <div
                  className={`bar-grow h-full rounded-full ${tone.bar}`}
                  style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }}
                />
              </div>
            </div>
          );
        })}

        {dimensions.length === 0 ? (
          <p className="text-sm text-ink-500">本次未返回维度明细。</p>
        ) : null}
      </div>
    </section>
  );
}
