import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { UploadProgress } from "../../services/upload";
import { CompactUploadProgress } from "../CompactUploadProgress";

interface Props {
  note: string;
  files: File[];
  busy: boolean;
  progress: UploadProgress | null;
  onNoteChange: (note: string) => void;
  onFilesChange: (files: File[]) => void;
  onCancel: () => void;
  onCancelUpload: () => void;
  onSubmit: (event: MouseEvent | KeyboardEvent) => void;
}

export function CollabReviewAgainForm({
  note, files, busy, progress, onNoteChange, onFilesChange, onCancel, onCancelUpload, onSubmit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="collab-re-review-box" onClick={(event) => event.stopPropagation()}>
      <div className="collab-re-review-label">补充审核意见或添加附件（可选）</div>
      <textarea
        className="collab-re-review-textarea"
        aria-label="补充审核意见"
        autoFocus
        rows={3}
        disabled={busy}
        value={note}
        placeholder="输入希望审核员一并核查的关注点或修改意见"
        onChange={(event) => onNoteChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit(event);
          } else if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {files.length > 0 && (
        <div className="collab-attach-files">
          {files.map((file, index) => (
            <span key={index} className="collab-attach-file-chip">
              <span className="collab-attach-file-name" title={file.name}>{file.name}</span>
              <button
                type="button"
                className="collab-attach-file-remove"
                disabled={busy}
                aria-label={`移除附件 ${file.name}`}
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </span>
          ))}
          <CompactUploadProgress
            progress={progress}
            label="正在上传附件"
            statusLabel="上传中"
            cancelLabel="取消上传"
            onCancel={onCancelUpload}
          />
        </div>
      )}
      <div className="collab-re-review-actions">
        <input
          ref={inputRef}
          type="file"
          aria-label="审核附件"
          multiple
          hidden
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = "";
            if (selected.length > 0) onFilesChange([...files, ...selected]);
          }}
        />
        <button type="button" className="collab-attach-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          添加附件
        </button>
        <button type="button" className="collab-ghost-btn" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="collab-btn-primary" disabled={busy} onClick={onSubmit}>
          {busy ? (progress ? "正在上传..." : "正在启动...") : "开始再审"}
        </button>
      </div>
    </div>
  );
}
