import { useMemo, useState } from "react";
import { SAMPLE_JD, SAMPLE_RESUME } from "../lib/sample";
import { AlertIcon, ArrowRightIcon, InfoIcon, SpinnerIcon } from "./icons";

const MIN_CHARS = 30;
const MAX_CHARS = 20000;

interface TextPanelProps {
  index: string;
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onFillSample: () => void;
}

function TextPanel({
  index,
  title,
  hint,
  placeholder,
  value,
  onChange,
  onFillSample,
}: TextPanelProps) {
  const chars = value.trim().length;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl2 border border-surface-line bg-white shadow-card transition-colors focus-within:border-brand-300">
      <div className="flex items-center justify-between border-b border-surface-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="num rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
            {index}
          </span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <span
          className={`num text-xs ${chars > MAX_CHARS ? "text-rose-600" : "text-ink-500"}`}
        >
          {chars.toLocaleString("zh-CN")} 字
        </span>
      </div>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_CHARS}
        placeholder={placeholder}
        spellCheck={false}
        className="h-72 w-full resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-ink-900 placeholder:text-ink-300 focus:outline-none"
      />

      <div className="flex items-center justify-between border-t border-surface-line bg-surface-soft/60 px-4 py-2">
        <span className="text-[11px] text-ink-500">{hint}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFillSample}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
          >
            填入示例
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={!value}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>
    </section>
  );
}

interface InputPageProps {
  loading: boolean;
  error: string | null;
  onSubmit: (resume: string, jd: string) => void;
}

export function InputPage({ loading, error, onSubmit }: InputPageProps) {
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");

  const resumeChars = resume.trim().length;
  const jdChars = jd.trim().length;

  const canSubmit = useMemo(
    () => resumeChars >= MIN_CHARS && jdChars >= MIN_CHARS && !loading,
    [resumeChars, jdChars, loading]
  );

  const shortHint = useMemo(() => {
    if (resumeChars > 0 && resumeChars < MIN_CHARS) return "简历内容偏短，至少 30 字";
    if (jdChars > 0 && jdChars < MIN_CHARS) return "岗位 JD 偏短，至少 30 字";
    return "";
  }, [resumeChars, jdChars]);

  return (
    <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
      <div className="rise-in max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          AI 匹配分析
        </span>
        <h1 className="mt-4 text-[28px] font-semibold leading-snug tracking-tight sm:text-[34px]">
          这份简历，配得上这个岗位吗？
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          把简历和岗位 JD 贴进来，30 秒拿到匹配分、维度拆解、亮点与待补齐项。所有分析只针对本次文本，不保存。
        </p>
      </div>

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <TextPanel
          index="01"
          title="简历内容"
          hint="建议粘贴完整的教育与项目经历"
          placeholder="把你的简历全文粘到这里，纯文本即可，不用管格式…"
          value={resume}
          onChange={setResume}
          onFillSample={() => setResume(SAMPLE_RESUME)}
        />
        <TextPanel
          index="02"
          title="岗位 JD"
          hint="职责与任职要求都要带上"
          placeholder="把目标岗位的 JD 粘到这里，越完整分析越准…"
          value={jd}
          onChange={setJd}
          onFillSample={() => setJd(SAMPLE_JD)}
        />
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-7 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-ink-500">
          {shortHint || `两段文本各需不少于 ${MIN_CHARS} 字，总字数上限 ${MAX_CHARS.toLocaleString("zh-CN")}`}
        </p>

        <button
          type="button"
          onClick={() => onSubmit(resume.trim(), jd.trim())}
          disabled={!canSubmit}
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
        >
          {loading ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              正在诊断…
            </>
          ) : (
            <>
              开始诊断
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>

      <p className="mt-10 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          结果由 AI 生成，仅作为简历优化的参考方向，不代表任何企业的真实录用判断。请勿上传他人隐私信息。
        </span>
      </p>
    </main>
  );
}
