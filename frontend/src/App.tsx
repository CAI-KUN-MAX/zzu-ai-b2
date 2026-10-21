import { useEffect, useState } from "react";
import { DiagnoseError, diagnose } from "./api/diagnose";
import { Header } from "./components/Header";
import { InputPage } from "./components/InputPage";
import { ResultPage } from "./components/ResultPage";
import type { DiagnoseResponse } from "./types";

type View = { name: "input" } | { name: "result"; data: DiagnoseResponse };

export default function App() {
  const [view, setView] = useState<View>({ name: "input" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name]);

  async function handleSubmit(resume: string, jd: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await diagnose({ resume_text: resume, jd_text: jd });
      setView({ name: "result", data });
    } catch (err) {
      setError(err instanceof DiagnoseError ? err.message : "诊断失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setError(null);
    setView({ name: "input" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="flex-1">
        {view.name === "input" ? (
          <InputPage loading={loading} error={error} onSubmit={handleSubmit} />
        ) : (
          <ResultPage data={view.data} onReset={handleReset} />
        )}
      </div>

      <footer className="border-t border-surface-line bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-5 text-[11px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <span>简历诊断 · 前后端分离演示版</span>
          <span>接口 POST /api/diagnose · 数据仅用于本次分析</span>
        </div>
      </footer>
    </div>
  );
}
