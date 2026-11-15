import { useEffect, useRef, useState } from "react";
import { getHistoryDetail, listHistory, type HistoryDetail, type HistoryEntry, type HistoryFilter, type HistoryList } from "../api/history";
import type { StoredJobMatch } from "../lib/jobMatchStorage";

interface HistoryPageProps {
  authenticated: boolean;
  onOpenMatch: (match: Omit<StoredJobMatch, "version">) => void;
  onUseResume: (entry: HistoryEntry) => void;
}

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "全部记录" },
  { value: "job_match", label: "岗位匹配" },
  { value: "resume", label: "简历" },
  { value: "interview", label: "模拟面试" },
];
const KIND_LABEL = { job_match: "岗位匹配", resume: "简历", interview: "模拟面试" };
const STATUS_LABEL: Record<string, string> = {
  queued: "排队中", running: "处理中", succeeded: "已完成", failed: "未完成",
  ready: "解析完成", need_review: "建议核对", parsing: "解析中", not_resume: "不是简历",
  active: "进行中", completed: "已完成", expired: "会话已过期",
};

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN");
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "暂时无法加载记录，请稍后重试";
}

export function HistoryPage({ authenticated, onOpenMatch, onUseResume }: HistoryPageProps) {
  const [kind, setKind] = useState<HistoryFilter>("all");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<HistoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const detailSection = useRef<HTMLElement | null>(null);
  const identity = useRef(authenticated);
  identity.current = authenticated;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    detailController.current?.abort();
    setOpeningId(null);
    setDetail(null);
    setDetailError(null);
    setLoading(true);
    setError(null);
    setData(null);
    listHistory(kind, page, controller.signal).then((value) => {
      if (!cancelled) setData(value);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(errorText(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); detailController.current?.abort(); };
  }, [kind, page, attempt, authenticated]);

  useEffect(() => {
    if (detail) detailSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  async function openEntry(entry: HistoryEntry) {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    const currentIdentity = authenticated;
    setOpeningId(entry.id);
    setDetail(null);
    setDetailError(null);
    try {
      const value = await getHistoryDetail(entry, controller.signal);
      if (controller.signal.aborted || identity.current !== currentIdentity) return;
      if (entry.kind === "job_match") {
        if (!value.match) throw new Error("这条记录暂时无法恢复匹配结果，请稍后重试");
        onOpenMatch(value.match);
      } else {
        if (!value.resume && !value.interview) throw new Error("记录详情暂不可用，请稍后重试");
        setDetail(value);
      }
    } catch (cause) {
      if (!controller.signal.aborted && identity.current === currentIdentity) setDetailError(errorText(cause));
    } finally {
      if (!controller.signal.aborted) setOpeningId(null);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const canUseResume = detail?.entry.kind === "resume" && detail.entry.ingest_task_id &&
    ["ready", "need_review"].includes(detail.entry.resume_status ?? detail.entry.status);

  return (
    <main className="offer-picker min-w-0 [overflow-wrap:anywhere]">
      <div className="picker-title">
        <div><span className="offer-eyebrow">YOUR ACTIVITY</span><h1>历史记录</h1>
          <p>{authenticated ? "查看当前账号保存的简历、岗位匹配和模拟面试记录。" : "查看当前游客的历史记录。清除浏览器 Cookie 后，可能无法找回游客记录。"}</p>
        </div>
        <button type="button" className="picker-last" onClick={() => setAttempt(value => value + 1)} disabled={loading}>刷新记录</button>
      </div>

      <section className="picker-panel min-w-0" aria-label="历史记录列表">
        <div className="flex flex-wrap gap-2" role="group" aria-label="记录类型">
          {FILTERS.map(filter => <button key={filter.value} type="button" aria-pressed={kind === filter.value}
            onClick={() => { setKind(filter.value); setPage(1); }}
            className={`rounded-xl px-3 py-2 text-sm ${kind === filter.value ? "bg-brand-600 text-white" : "border border-surface-line bg-white text-ink-700"}`}>{filter.label}</button>)}
        </div>
        {loading ? <p className="picker-hint" role="status">正在加载历史记录…</p> : error ? (
          <p className="picker-error" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button></p>
        ) : !data?.items.length ? <p className="picker-empty">这里还没有{kind === "all" ? "历史" : FILTERS.find(filter => filter.value === kind)?.label}记录。</p> : (
          <>
            <p className="picker-hint">共 {data.total} 条记录，按最近创建时间排列。</p>
            <ul className="mt-4 grid min-w-0 gap-3">
              {data.items.map(entry => <li key={`${entry.kind}:${entry.id}`} className="min-w-0 rounded-xl border border-surface-line bg-white/70 p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <span className="text-xs text-brand-600">{KIND_LABEL[entry.kind]} · {STATUS_LABEL[entry.status] ?? entry.status}</span>
                    <h2 className="mt-1 text-sm font-semibold text-ink-900">{entry.title || KIND_LABEL[entry.kind]}</h2>
                    {entry.resume_name && entry.kind !== "resume" ? <p className="mt-1 text-xs text-ink-500">简历：{entry.resume_name}</p> : null}
                    <p className="mt-1 text-xs text-ink-500">{displayTime(entry.created_at)}
                      {entry.kind === "interview" && entry.round != null ? ` · 第 ${entry.round}${entry.max_rounds ? ` / ${entry.max_rounds}` : ""} 轮` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => void openEntry(entry)} disabled={openingId === entry.id}
                    className="shrink-0 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    aria-label={`查看${entry.title || KIND_LABEL[entry.kind]}`}>{openingId === entry.id ? "加载中…" : entry.kind === "job_match" ? "查看匹配" : "查看详情"}</button>
                </div>
              </li>)}
            </ul>
            <nav className="mt-5 flex flex-wrap items-center justify-center gap-3" aria-label="历史记录分页">
              <button type="button" className="picker-last disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
              <span className="text-xs text-ink-500">第 {page} / {pages} 页</span>
              <button type="button" className="picker-last disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>下一页</button>
            </nav>
          </>
        )}
        {detailError ? <p className="picker-error" role="alert">{detailError}，可再次点击该条记录重试。</p> : null}
      </section>

      {detail ? <section ref={detailSection} className="picker-panel mt-5 min-w-0" aria-label="历史记录详情">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{detail.entry.title}</h2>
          <button type="button" className="picker-last" onClick={() => setDetail(null)}>收起详情</button></div>
        {detail.resume ? <>
          <p className="picker-hint">简历提取文本 · {detail.resume.chars} 字 · {STATUS_LABEL[detail.resume.status] ?? detail.resume.status}</p>
          <pre className="mt-3 max-h-[65vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/70 p-4 text-sm leading-relaxed [overflow-wrap:anywhere]">{detail.resume.text || "这份简历暂时没有可查看的提取文本。"}</pre>
          {canUseResume ? <button type="button" className="picker-last mt-4" onClick={() => onUseResume(detail.entry)}>用这份简历匹配岗位 →</button> : null}
        </> : null}
        {detail.interview ? <>
          <p className="picker-hint">简历：{detail.interview.resume_name || detail.entry.resume_name || "未记录名称"} · {STATUS_LABEL[detail.interview.status] ?? detail.interview.status}</p>
          {detail.interview.expired ? <p className="mt-2 text-xs text-amber-700">此面试会话已过期，历史问答和反馈仍可回看。</p> : <p className="mt-2 text-xs text-ink-500">以下为已保存的问答与反馈。</p>}
          <details className="mt-3 rounded-xl border border-surface-line p-3"><summary className="cursor-pointer text-sm">查看当时的岗位要求</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{detail.interview.jd_text}</p></details>
          {detail.interview.turns.length ? <ol className="mt-4 grid gap-4">{detail.interview.turns.map((turn, index) => <li key={index} className="rounded-xl bg-white/70 p-4">
            <h3 className="text-sm font-semibold">第 {index + 1} 轮 · {turn.question.text}</h3>
            <p className="mt-3 text-xs font-semibold text-ink-500">你的回答</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{turn.answer}</p>
            {([['strengths', '做得好'], ['improvements', '可以改进'], ['reference_points', '参考要点']] as const).map(([key, label]) => turn.feedback[key].length ? <div key={key} className="mt-3"><h4 className="text-xs font-semibold text-brand-700">{label}</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-relaxed">{turn.feedback[key].map((text, itemIndex) => <li key={itemIndex}>{text}</li>)}</ul></div> : null)}
          </li>)}</ol> : <p className="picker-hint">这次面试尚未保存回答。</p>}
          {detail.interview.status === "active" && detail.interview.question ? <div className="mt-4 rounded-xl bg-white/70 p-4"><h3 className="text-sm font-semibold">尚未作答的问题</h3><p className="mt-2 whitespace-pre-wrap text-sm">{detail.interview.question.text}</p></div> : null}
        </> : null}
      </section> : null}
    </main>
  );
}
