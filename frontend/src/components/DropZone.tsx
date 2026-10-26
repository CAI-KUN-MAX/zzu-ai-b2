import { useRef, useState } from "react";
import { MAX_FILES, validateFiles } from "../api/resumes";
import { FileIcon, UploadIcon, XIcon } from "./icons";

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

/** 拖拽上传区：支持点击选择、拖入、单条删除，前端先做扩展名与大小预校验 */
export function DropZone({
  files,
  onChange,
  disabled = false,
  maxFiles = MAX_FILES,
  title = "拖拽简历到这里，或",
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

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

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl2 border-2 border-dashed px-6 py-10 text-center transition-colors ${
          disabled
            ? "cursor-not-allowed border-surface-line bg-surface-soft/60"
            : dragging
              ? "border-brand-400 bg-brand-50/60"
              : "border-surface-line bg-white hover:border-brand-300 hover:bg-brand-50/30"
        }`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <UploadIcon className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-ink-700">
          {title}
          <span className="text-brand-600">点击选择文件</span>
        </p>
        <p className="text-[11px] text-ink-500">
          支持 PDF / DOCX / PNG / JPG，{maxFiles === 1 ? "单个文件" : `最多 ${maxFiles} 份`}
          ，单份不超过 15MB
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          hidden
          accept=".pdf,.docx,.png,.jpg,.jpeg"
          onChange={(event) => {
            addFiles(event.target.files);
            // 允许重复选择同一个文件
            event.target.value = "";
          }}
        />
      </div>

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
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-2.5 border-b border-surface-line/60 px-4 py-2.5 last:border-b-0"
              >
                <FileIcon className="h-4 w-4 shrink-0 text-ink-300" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700" title={file.name}>
                  {file.name}
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
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
