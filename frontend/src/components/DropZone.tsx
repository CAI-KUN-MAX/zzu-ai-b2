import { useRef, useState } from "react";
import {
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  MAX_FILES,
  fileKindOf,
  fileTypeLabel,
  validateFiles,
} from "../api/resumes";
import { AlertIcon, FileIcon, UploadIcon, XIcon } from "./icons";

interface DropZoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** 最多可选文件数，默认 20；岗位匹配场景传 1 */
  maxFiles?: number;
  /** 主提示文案，不同场景可覆盖 */
  title?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 微信内置浏览器：文档选择能力受限，需要给替代方案而不是让按钮“点了没反应” */
function isWeChatBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

/**
 * 上传区：文档与照片拆成两个明确入口，各自使用准确的 accept。
 * 文档入口不出现 image/*，避免移动端直接跳相册；微信内给替代方案与复制链接。
 */
export function DropZone({
  files,
  onChange,
  disabled = false,
  maxFiles = MAX_FILES,
  title = "拖拽简历到这里",
}: DropZoneProps) {
  const docInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const inWeChat = isWeChatBrowser();

  function addFiles(incoming: FileList | null) {
    if (!incoming || disabled) return;

    const { ok, errors: invalid } = validateFiles(Array.from(incoming));
    const next = [...files];
    const duplicates: string[] = [];

    ok.forEach((file) => {
      if (next.length >= maxFiles) return;
      const exists = next.some((item) => item.name === file.name && item.size === file.size);
      if (exists) {
        duplicates.push(`${file.name}：已在列表中`);
        return;
      }
      next.push(file);
    });

    const overflow =
      files.length + ok.length > maxFiles ? [`最多 ${maxFiles} 份，超出部分已忽略`] : [];

    setErrors([...invalid, ...duplicates, ...overflow]);
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  async function copyPageUrl() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 非安全上下文或老浏览器：退回到手动选中复制
      const holder = document.createElement("textarea");
      holder.value = url;
      holder.style.position = "fixed";
      holder.style.opacity = "0";
      document.body.appendChild(holder);
      holder.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 复制失败也不阻塞用户 */
      }
      document.body.removeChild(holder);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl2 border-2 border-dashed px-5 py-8 text-center transition-colors ${
          disabled
            ? "border-surface-line bg-surface-soft/60"
            : dragging
              ? "border-brand-400 bg-brand-50/60"
              : "border-surface-line bg-white hover:border-brand-300 hover:bg-brand-50/30"
        }`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <UploadIcon className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-ink-700">{title}</p>

        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileIcon className="h-3.5 w-3.5" />
            选择文档
            <span className="text-[10px] text-ink-500">PDF / DOCX</span>
          </button>
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadIcon className="h-3.5 w-3.5" />
            选择照片
            <span className="text-[10px] text-ink-500">PNG / JPG</span>
          </button>
        </div>

        <p className="mt-1 text-[11px] text-ink-500">
          也可以直接拖进来，{maxFiles === 1 ? "单个文件" : `最多 ${maxFiles} 份`}，单份不超过 15MB
        </p>

        {/* 文档入口：只给文档扩展名与 MIME，绝不含 image/* */}
        <input
          ref={docInputRef}
          type="file"
          hidden
          accept={DOCUMENT_ACCEPT}
          multiple={maxFiles > 1}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {/* 图片入口：只给位图 */}
        <input
          ref={imgInputRef}
          type="file"
          hidden
          accept={IMAGE_ACCEPT}
          multiple={maxFiles > 1}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {inWeChat ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-800">
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              微信内置浏览器对选择文档的支持有限，点「选择文档」可能只能看到相册。建议改用系统浏览器打开本页
              —— 点右上角「…」选择「在浏览器中打开」，或先复制链接再粘贴到浏览器。
            </span>
          </p>
          <button
            type="button"
            onClick={copyPageUrl}
            className="mt-2 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-700"
          >
            {copied ? "已复制链接" : "复制当前网址"}
          </button>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <div className="rounded-xl2 border border-surface-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-surface-line px-4 py-2.5">
            <span className="text-[12px] font-medium text-ink-700">已选文件</span>
            <span className="num text-[11px] text-ink-500">
              {files.length} / {maxFiles}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {files.map((file, index) => {
              const kind = fileKindOf(file.name);
              return (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex items-center gap-2.5 border-b border-surface-line/60 px-4 py-2.5 last:border-b-0"
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-ink-300" />
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] text-ink-700"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  {/* 上传前明确展示类型和大小 */}
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
                    {fileTypeLabel(file.name)}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-500">
                    {kind === "image" ? "图片" : kind === "document" ? "文档" : "未知"}
                  </span>
                  <span className="num shrink-0 text-[11px] text-ink-500">
                    {formatSize(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    disabled={disabled}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    aria-label={`移除 ${file.name}`}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
