import type { DiagnoseResponse } from "../types";
import { levelTone } from "../lib/theme";
import { ScoreRing } from "./ScoreRing";
import { DimensionBars } from "./report/DimensionBars";
import { Highlights } from "./report/Highlights";
import { Gaps } from "./report/Gaps";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon } from "./icons";

interface ResultPageProps {
  data: DiagnoseResponse;
  onReset: () => void;
}

export function ResultPage({ data, onReset }: ResultPageProps) {
  const tone = levelTone(data.level);

  return (
    <main className="mx-auto max-w-6xl px-6 pb-20 pt-8">
      {/* 顶部操作条 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          重新粘贴
        </button>
      </div>

      {/* 总分卡 */}
      <section className="rise-in mt-3 overflow-hidden rounded-xl2 border border-surface-line bg-white shadow-card">
        <div className="grid justify-items-center gap-7 p-6 sm:grid-cols-[auto,1fr] sm:items-center sm:justify-items-stretch sm:gap-8 sm:p-8">
          <ScoreRing score={data.overall_score} color={tone.ring} />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tone.chip}`}
              >
                {data.level_label}
              </span>
              <span className="text-xs text-ink-500">综合匹配度</span>
            </div>

            <p className="mt-3.5 text-[15px] leading-relaxed text-ink-700">{data.summary}</p>

            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-ink-500">
              <span>
                由 <span className="font-medium text-ink-700">{data.meta.model}</span> 生成
              </span>
              <span>
                耗时{" "}
                <span className="num font-medium text-ink-700">
                  {data.meta.elapsed_ms >= 1000
                    ? `${(data.meta.elapsed_ms / 1000).toFixed(1)} 秒`
                    : `${data.meta.elapsed_ms} 毫秒`}
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <DimensionBars dimensions={data.dimension_scores} />
      <Highlights highlights={data.highlights} />
      <Gaps gaps={data.gaps} />

      {/* 底部：免责声明 + 再诊断 */}
      <div className="mt-10 flex flex-col gap-5 border-t border-surface-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex max-w-xl items-start gap-2 text-[11px] leading-relaxed text-ink-500">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{data.disclaimer}</span>
        </p>
        <button
          type="button"
          onClick={onReset}
          className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-surface-line bg-white px-5 py-2.5 text-sm font-medium text-ink-700 shadow-sm transition-all hover:border-brand-300 hover:text-brand-700"
        >
          换一份简历再诊断
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </main>
  );
}
