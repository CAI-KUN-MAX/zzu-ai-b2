import { LogoIcon } from "./icons";

/**
 * 主导航已收敛为「岗位匹配」一项，不再渲染可切换的导航条，右侧只保留静态模块标识。
 * 文本诊断与简历筛选的页面文件仍保留在仓库中，只是不作为主导航入口。
 */
export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-surface-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-sm">
            <LogoIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold tracking-tight">简历诊断</p>
            <p className="hidden truncate text-[11px] text-ink-500 sm:block">
              Resume × Job Match Report
            </p>
          </div>
        </div>

        <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-[12px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          岗位匹配
        </span>
      </div>
    </header>
  );
}
