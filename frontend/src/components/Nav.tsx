export type AppMode = "job" | "screen" | "diagnose";

const ITEMS: Array<{ key: AppMode; label: string; short: string }> = [
  { key: "job", label: "岗位匹配", short: "岗位" },
  { key: "screen", label: "简历筛选", short: "筛选" },
  { key: "diagnose", label: "文本诊断", short: "诊断" },
];

interface NavProps {
  value: AppMode;
  onChange: (mode: AppMode) => void;
}

/** 三个业务入口切换，用分段控件而不是路由；窄屏下用短标签避免挤爆 */
export function Nav({ value, onChange }: NavProps) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-slate-100/80 p-1 sm:gap-1">
      {ITEMS.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-[12px] font-medium transition-all sm:px-3 sm:text-[13px] ${
              active ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <span className="hidden sm:inline">{item.label}</span>
            <span className="sm:hidden">{item.short}</span>
          </button>
        );
      })}
    </div>
  );
}
