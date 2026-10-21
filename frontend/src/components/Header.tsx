import { IS_MOCK_MODE } from "../api/diagnose";
import { LogoIcon } from "./icons";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-surface-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-sm">
            <LogoIcon className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">简历诊断</p>
            <p className="text-[11px] text-ink-500">Resume × JD Match Report</p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
            IS_MOCK_MODE
              ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-emerald-50 text-emerald-700 ring-emerald-200"
          }`}
          title={IS_MOCK_MODE ? "当前使用本地 mock 数据，未请求后端" : "已连接真实后端接口"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${IS_MOCK_MODE ? "bg-amber-500" : "bg-emerald-500"}`}
          />
          {IS_MOCK_MODE ? "Mock 数据" : "已连接后端"}
        </span>
      </div>
    </header>
  );
}
