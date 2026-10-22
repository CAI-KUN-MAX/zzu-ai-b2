import type { DiagnoseResponse } from "../types";
import { levelTone, scoreTone, severityMeta } from "../lib/theme";
import { ScoreRing } from "./ScoreRing";
import { AlertIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon, InfoIcon, SparkIcon } from "./icons";

const SOURCE_LABEL: Record<string, string> = {
  resume: "来自简历",
  jd: "来自 JD",
};

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
        <span className="hidden text-[11px] text-ink-500 sm:block">
          ID {data.request_id.slice(0, 12)}
        </span>
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
                模型 <span className="font-medium text-ink-700">{data.meta.model}</span>
              </span>
              <span>
                耗时 <span className="num font-medium text-ink-700">{data.meta.elapsed_ms} ms</span>
              </span>
              <span>
                场景 <span className="font-medium text-ink-700">{data.meta.mode}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 维度得分 */}
      <section className="mt-6 rounded-xl2 border border-surface-line bg-white p-6 shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">维度得分</h2>
          <span className="text-[11px] text-ink-500">四项加权得出总分</span>
        </div>

        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {data.dimension_scores.map((dimension) => {
            const dimTone = scoreTone(dimension.score);
            return (
              <div key={dimension.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] text-ink-700">
                    {dimension.label}
                    <span className="ml-2 text-[11px] text-ink-500">
                      权重 {Math.round(dimension.weight * 100)}%
                    </span>
                  </span>
                  <span className={`num text-sm font-semibold ${dimTone.text}`}>
                    {dimension.score}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                  <div
                    className={`bar-grow h-full rounded-full ${dimTone.bar}`}
                    style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }}
                  />
                </div>
              </div>
            );
          })}

          {data.dimension_scores.length === 0 ? (
            <p className="text-sm text-ink-500">本次未返回维度明细。</p>
          ) : null}
        </div>
      </section>

      {/* 亮点 */}
      <section className="mt-8">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <SparkIcon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-semibold">简历亮点</h2>
          <span className="num rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            {data.highlights.length}
          </span>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {data.highlights.map((highlight, index) => (
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

          {data.highlights.length === 0 ? (
            <p className="text-sm text-ink-500">暂未识别出明确亮点，建议补充量化成果。</p>
          ) : null}
        </div>
      </section>

      {/* 缺口 */}
      <section className="mt-10">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-50 text-amber-600">
            <AlertIcon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-semibold">待补齐项</h2>
          <span className="num rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {data.gaps.length}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">
          按优先级排序，高优先级项建议在投递前优先修改。
        </p>

        <div className="mt-3 space-y-4">
          {data.gaps.map((gap, index) => {
            const severity = severityMeta(gap.severity);
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

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
                  <div className="rounded-xl bg-brand-50/70 p-3">
                    <p className="text-[11px] font-medium text-brand-700">改进建议</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                      {gap.suggestion}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}

          {data.gaps.length === 0 ? (
            <p className="rounded-2xl border border-surface-line bg-white px-5 py-6 text-sm text-ink-500">
              未发现明显缺口，简历与岗位要求基本对齐。
            </p>
          ) : null}
        </div>
      </section>

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
