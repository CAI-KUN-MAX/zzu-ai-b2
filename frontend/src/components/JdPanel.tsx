interface JdPanelProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const MIN_CHARS = 30;
const MAX_CHARS = 20000;

/** 简历筛选页的 JD 输入框：视觉沿用输入页的双栏卡片，但独立实现，避免改动老页面 */
export function JdPanel({ value, onChange, disabled = false }: JdPanelProps) {
  const chars = value.trim().length;
  const tooShort = chars > 0 && chars < MIN_CHARS;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl2 border border-surface-line bg-white shadow-card transition-colors focus-within:border-brand-300">
      <div className="flex items-center justify-between border-b border-surface-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="num rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
            01
          </span>
          <h2 className="text-sm font-semibold">岗位 JD</h2>
        </div>
        <span className={`num text-xs ${tooShort ? "text-rose-600" : "text-ink-500"}`}>
          {chars.toLocaleString("zh-CN")} 字
        </span>
      </div>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={MAX_CHARS}
        spellCheck={false}
        placeholder="粘贴目标岗位的 JD，职责与任职要求都带上，匹配会更准…"
        className="h-80 w-full resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-ink-900 placeholder:text-ink-300 focus:outline-none disabled:bg-surface-soft/50"
      />

      <div className="flex items-center justify-between border-t border-surface-line bg-surface-soft/60 px-4 py-2">
        <span className={`text-[11px] ${tooShort ? "text-rose-600" : "text-ink-500"}`}>
          {tooShort ? `JD 至少 ${MIN_CHARS} 字` : `上限 ${MAX_CHARS.toLocaleString("zh-CN")} 字`}
        </span>
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={!value || disabled}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
        >
          清空
        </button>
      </div>
    </section>
  );
}
