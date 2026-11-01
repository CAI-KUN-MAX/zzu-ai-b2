import { useEffect } from "react";
import type { Job } from "../types";
import { CheckIcon, XIcon } from "./icons";

interface JobJdDialogProps {
  job: Job;
  selected: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** 选岗前查看完整 JD：岗位要求、学历专业、来源与核验时间，可直接在弹窗里勾选 */
export function JobJdDialog({ job, selected, onToggle, onClose }: JobJdDialogProps) {
  // Esc 关闭，打开期间锁住底层滚动
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const facts = [
    { label: "公司", value: job.company },
    { label: "城市", value: job.cities.join(" / ") },
    { label: "学历", value: job.education_requirement || job.education },
    { label: "专业", value: job.majors.length > 0 ? job.majors.join("、") : "不限" },
    { label: "届别", value: job.graduation_year ? String(job.graduation_year) : "未注明" },
    { label: "发布", value: job.published_at },
  ];

  return (
    <div
      className="offer-dialog fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${job.title} 岗位详情`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl [overflow-wrap:anywhere] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] text-ink-500">{job.category}</p>
            <h2 className="mt-0.5 text-[17px] font-semibold leading-snug text-ink-900">{job.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-surface-soft hover:text-ink-900"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="flex gap-3 text-[12px]">
                <dt className="w-10 shrink-0 text-ink-500">{fact.label}</dt>
                <dd className="min-w-0 flex-1 text-ink-900">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[11px] font-medium text-ink-500">岗位要求</p>
          <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-surface-soft/70 px-3.5 py-3 text-[13px] leading-relaxed text-ink-900">
            {job.jd_text}
          </p>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
            核验于 {job.verified_at.slice(0, 10)}，状态只代表核验当时的情况。
            <a href={job.source_url} target="_blank" rel="noreferrer" className="ml-1 text-brand-600 hover:underline">
              查看招聘来源
            </a>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-surface-line bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-brand-300"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => {
              onToggle();
              onClose();
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold ${
              selected
                ? "border border-surface-line bg-white text-ink-700 hover:border-rose-300 hover:text-rose-700"
                : "bg-brand-600 text-white hover:bg-brand-700"
            }`}
          >
            {selected ? "取消选择" : (
              <>
                <CheckIcon className="h-4 w-4" />
                选择这个岗位
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
