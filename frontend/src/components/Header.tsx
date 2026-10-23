import { LogoIcon } from "./icons";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-surface-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-sm">
            <LogoIcon className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">简历诊断</p>
            <p className="text-[11px] text-ink-500">Resume × JD Match Report</p>
          </div>
        </div>
      </div>
    </header>
  );
}
