import type { Highlight } from "../../types";
import { CheckIcon, SparkIcon } from "../icons";

const SOURCE_LABEL: Record<string, string> = {
  resume: "来自简历",
  jd: "来自 JD",
};

interface HighlightsProps {
  highlights: Highlight[];
  className?: string;
}

/** 简历亮点 —— 结果页与简历筛选的行内详情共用 */
export function Highlights({ highlights, className = "mt-8" }: HighlightsProps) {
  return (
    <section className={className}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
          <SparkIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">简历亮点</h2>
        <span className="num rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          {highlights.length}
        </span>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {highlights.map((highlight, index) => (
          <article
            key={`${highlight.title}-${index}`}
            className="rise-in rounded-2xl border border-surface-line bg-white p-5 shadow-card"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckIcon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold leading-snug">{highlight.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                  {highlight.evidence}
                </p>
                <span className="mt-3 inline-block text-[11px] text-ink-500">
                  {SOURCE_LABEL[highlight.source] ?? "来自简历"}
                </span>
              </div>
            </div>
          </article>
        ))}

        {highlights.length === 0 ? (
          <p className="text-sm text-ink-500">暂未识别出明确亮点，建议补充量化成果。</p>
        ) : null}
      </div>
    </section>
  );
}
