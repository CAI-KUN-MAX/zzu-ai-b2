export type AppMode = "diagnose" | "screen";

const ITEMS: Array<{ key: AppMode; label: string }> = [
  { key: "diagnose", label: "文本诊断" },
  { key: "screen", label: "简历筛选" },
];

interface NavProps {
  value: AppMode;
  onChange: (mode: AppMode) => void;
}

/** 两个业务入口切换，用分段控件而不是路由 */
export function Nav({ value, onChange }: NavProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1">
      {ITEMS.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
              active
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
