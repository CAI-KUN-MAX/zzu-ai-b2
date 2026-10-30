import { useState } from "react";
import type { Gap } from "../../types";
import { CheckIcon, SparkIcon } from "../icons";

interface RewriteSuggestionsProps {
  gaps: Gap[];
  className?: string;
}

/** 把模型给出的可用句子单独呈现，避免用户在缺口卡片里寻找改写结果。 */
export function RewriteSuggestions({ gaps, className = "mt-10" }: RewriteSuggestionsProps) {
  const items = gaps.filter((gap) => Boolean(gap.rewrite_suggestion?.trim()));
  const [copyState, setCopyState] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function copySuggestion(text: string, key: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const holder = document.createElement("textarea");
      holder.value = text;
      holder.style.position = "fixed";
      holder.style.opacity = "0";
      document.body.appendChild(holder);
      holder.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      document.body.removeChild(holder);
    }
    setCopyState(copied ? key : `error:${key}`);
    window.setTimeout(() => setCopyState(null), 2000);
  }

  return (
    <section className={className}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <SparkIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">简历改写建议</h2>
        <span className="num rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
          {items.length}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
        可作为修改草稿；带【占位符】的内容必须替换为真实经历与数据后再使用。
      </p>

      <div className="mt-3 space-y-3">
        {items.map((gap, index) => (
          <article
            key={`${gap.title}-rewrite-${index}`}
            className="rounded-2xl border border-brand-100 bg-brand-50/50 p-5"
          >
            <h3 className="text-[13px] font-semibold text-ink-900">{gap.title}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium text-ink-500">当前表述</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                  {gap.resume_evidence || "简历中尚未体现，请勿直接声称已有相关经历。"}
                </p>
              </div>
              <div className="rounded-xl border border-brand-100 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium text-brand-700">建议改写</p>
                  <button
                    type="button"
                    onClick={() =>
                      copySuggestion(
                        gap.rewrite_suggestion ?? "",
                        `${gap.title}-rewrite-${index}`
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[10px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
                    aria-label={`复制“${gap.title}”的改写建议`}
                  >
                    {copyState === `${gap.title}-rewrite-${index}` ? (
                      <CheckIcon className="h-3 w-3" />
                    ) : null}
                    {copyState === `${gap.title}-rewrite-${index}` ? "已复制" : "一键复制"}
                  </button>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-800">
                  {gap.rewrite_suggestion}
                </p>
                {copyState === `error:${gap.title}-rewrite-${index}` ? (
                  <p role="alert" className="mt-1.5 text-[10px] text-rose-600">
                    自动复制失败，请长按或选中文字复制。
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
