import { useMemo, useState } from "react";
import type { IngestTask, ResumeStatus } from "../types";
import {
  STATUS_LABEL,
  getIngestTasks,
  getResumeText,
  joinTaskIds,
  uploadInBatches,
  type UploadedBatch,
} from "../api/resumes";
import { createMatch } from "../api/match";
import { useTask } from "../lib/useTask";
import { JdPanel } from "./JdPanel";
import { DropZone } from "./DropZone";
import { AlertIcon, ArrowRightIcon, InfoIcon, SpinnerIcon } from "./icons";

const MIN_JD_CHARS = 30;

const STATUS_STYLE: Record<ResumeStatus, { dot: string; chip: string }> = {
  ready: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  need_review: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  failed: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
};

interface ScreenPageProps {
  onStartMatch: (matchTaskId: string, ingest: IngestTask, jdText: string) => void;
}

export function ScreenPage({ onStartMatch }: ScreenPageProps) {
  const [jdText, setJdText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  // 拆批上传后每批一个解析任务，合并轮询
  const [batches, setBatches] = useState<UploadedBatch[]>([]);
  const [uploadNotes, setUploadNotes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestTaskId = batches.length > 0 ? joinTaskIds(batches) : null;
  const { data: ingest, error: pollError, polling } = useTask<IngestTask>(
    (_id, signal) => getIngestTasks(batches, signal),
    ingestTaskId
  );

  const [openedId, setOpenedId] = useState<string | null>(null);
  const [openedText, setOpenedText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const jdChars = jdText.trim().length;
  const canSubmit = useMemo(
    () => jdChars >= MIN_JD_CHARS && files.length > 0 && !submitting && !ingestTaskId,
    [jdChars, files.length, submitting, ingestTaskId]
  );

  const needReviewCount =
    ingest?.items.filter((item) => item.status === "need_review").length ?? 0;
  const failedCount = ingest?.items.filter((item) => item.status === "failed").length ?? 0;
  const matchableIds =
    ingest?.items.filter((item) => item.status !== "failed").map((item) => item.resume_id) ?? [];

  async function handleUpload() {
    setSubmitting(true);
    setError(null);
    try {
      const { batches: uploaded, errors } = await uploadInBatches(files);
      if (uploaded.length === 0) {
        setError(errors.join("\n") || "上传失败，请重试");
      } else {
        setUploadNotes(errors);
        setBatches(uploaded);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMatch() {
    if (!ingest || matchableIds.length === 0) return;
    setMatching(true);
    setError(null);
    try {
      const { task_id } = await createMatch(jdText.trim(), matchableIds);
      onStartMatch(task_id, ingest, jdText.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建匹配任务失败，请重试");
    } finally {
      setMatching(false);
    }
  }

  function resetAll() {
    setBatches([]);
    setUploadNotes([]);
    setOpenedId(null);
    setOpenedText(null);
    setError(null);
  }

  async function toggleText(resumeId: string) {
    if (openedId === resumeId) {
      setOpenedId(null);
      setOpenedText(null);
      return;
    }
    setOpenedId(resumeId);
    setOpenedText(null);
    setTextLoading(true);
    try {
      const detail = await getResumeText(resumeId);
      setOpenedText(detail.text || "（该简历没有可提取的文本）");
    } catch {
      setOpenedText("全文加载失败，请稍后重试");
    } finally {
      setTextLoading(false);
    }
  }

  /* ---------------- 解析进度视图 ---------------- */
  if (ingestTaskId) {
    const percent = Math.max(0, Math.min(100, ingest?.progress ?? 0));
    const done = ingest?.status === "succeeded";
    // 全部失败时任务已停止，不能再显示“正在解析”
    const allFailed = ingest?.status === "failed";
    const stopped = done || allFailed || (!polling && Boolean(pollError));

    return (
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-10">
        <div className="rounded-xl2 border border-surface-line bg-white p-6 shadow-card sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight">
                {done ? "简历解析完成" : allFailed ? "简历解析失败" : stopped ? "解析状态获取失败" : "正在解析简历"}
              </h1>
              <p className="mt-1.5 text-[13px] text-ink-500">
                {allFailed ? "所有文件都未能解析，请根据下方原因处理后重新上传" : ingest?.stage || "准备中…"}
                {done
                  ? [
                      needReviewCount > 0 ? `其中 ${needReviewCount} 份建议人工核对` : "",
                      failedCount > 0 ? `${failedCount} 份解析失败` : "",
                    ]
                      .filter(Boolean)
                      .map((text) => ` · ${text}`)
                      .join("")
                  : ""}
              </p>
            </div>
            <span
              className={`num rounded-full px-3 py-1 text-[12px] font-semibold ${
                allFailed ? "bg-rose-50 text-rose-700" : "bg-brand-50 text-brand-700"
              }`}
            >
              {percent}%
            </span>
          </div>

          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${allFailed ? "bg-rose-500" : "bg-brand-600"}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {pollError ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{pollError}</span>
            </div>
          ) : null}

          {uploadNotes.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700">
              <p className="font-medium">以下文件所在批次未能上传，其余文件继续解析：</p>
              <ul className="mt-1 space-y-0.5">
                {uploadNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="mt-6 space-y-2">
            {(ingest?.items ?? []).map((item) => {
              const style = STATUS_STYLE[item.status];
              const isOpen = openedId === item.resume_id;
              return (
                <li key={item.resume_id} className="rounded-xl border border-surface-line">
                  <button
                    type="button"
                    onClick={() =>
                      item.status === "failed"
                        ? setOpenedId(isOpen ? null : item.resume_id)
                        : toggleText(item.resume_id)
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-soft/60"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">
                      {item.name}
                    </span>
                    <span className="num shrink-0 text-[11px] text-ink-500">
                      {item.chars.toLocaleString("zh-CN")} 字
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style.chip}`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                  </button>

                  {item.status === "failed" ? (
                    <p className="border-t border-surface-line bg-rose-50/60 px-4 py-2.5 text-[12px] leading-relaxed text-rose-700">
                      {item.error?.message ?? "解析失败，请重新上传"}
                    </p>
                  ) : null}

                  {isOpen && item.status !== "failed" ? (
                    <div className="border-t border-surface-line bg-surface-soft/40 px-4 py-3">
                      {textLoading ? (
                        <p className="flex items-center gap-2 text-[12px] text-ink-500">
                          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                          加载全文…
                        </p>
                      ) : (
                        <>
                          {item.status === "need_review" ? (
                            <p className="mb-2 text-[11px] text-amber-700">
                              {(item.low_conf ?? 0) > 0
                                ? `有 ${item.low_conf} 行识别置信度偏低，建议核对原始文件后再确认匹配结果。`
                                : "提取到的文字较少，建议核对原始文件是否完整。"}
                            </p>
                          ) : null}
                          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">
                            {openedText}
                          </pre>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}

            {polling && !ingest ? (
              <li className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-500">
                <SpinnerIcon className="h-4 w-4 animate-spin" />
                正在上传并解析…
              </li>
            ) : null}
          </ul>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-line">{error}</span>
            </div>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 border-t border-surface-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-ink-500">
              {done
                ? `${matchableIds.length} 份可用于匹配${needReviewCount > 0 ? `，${needReviewCount} 份建议核对` : ""}${failedCount > 0 ? `，${failedCount} 份解析失败` : ""}`
                : stopped
                  ? "解析已结束，请重新上传"
                  : "解析期间请不要关闭页面"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetAll}
                className="rounded-xl border border-surface-line bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                重新上传
              </button>
              <button
                type="button"
                disabled={!done || matchableIds.length === 0 || matching}
                onClick={handleMatch}
                className="group inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
              >
                {matching ? (
                  <>
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                    正在创建任务…
                  </>
                ) : (
                  <>
                    开始匹配
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ---------------- 表单视图 ---------------- */
  return (
    <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
      <div className="rise-in max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          批量筛选
        </span>
        <h1 className="mt-4 text-[28px] font-semibold leading-snug tracking-tight sm:text-[34px]">
          一份 JD，筛一批简历
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          粘贴岗位要求，拖入简历文件，自动完成文本解析、逐份打分与排序。解析完成后可直接查看分数构成与改进建议。
        </p>
      </div>

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <JdPanel value={jdText} onChange={setJdText} disabled={submitting} />
        <DropZone files={files} onChange={setFiles} disabled={submitting} />
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-pre-line leading-relaxed">{error}</span>
        </div>
      ) : null}

      <div className="mt-7 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-ink-500">
          {jdChars < MIN_JD_CHARS
            ? `JD 至少 ${MIN_JD_CHARS} 字，当前 ${jdChars} 字`
            : files.length === 0
              ? "请至少选择 1 份简历"
              : `已选 ${files.length} 份简历，将先解析文本再逐份匹配`}
        </p>

        <button
          type="button"
          onClick={handleUpload}
          disabled={!canSubmit}
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
        >
          {submitting ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              正在上传…
            </>
          ) : (
            <>
              开始解析
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>

      <p className="mt-10 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          上传的简历会暂存在服务端用于本次匹配分析，不会对外分享。匹配结果由 AI 生成，仅供参考。
        </span>
      </p>
    </main>
  );
}
