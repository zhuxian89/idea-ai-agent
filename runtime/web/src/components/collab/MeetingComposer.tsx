import { useEffect, useRef, useState } from "react";
import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot } from "../../services/collab";
import { isUploadAbortError, uploadFiles, type UploadProgress } from "../../services/upload";
import { CompactUploadProgress } from "../CompactUploadProgress";
import { AgentIcon } from "../AgentIcon";
import { formatUploadAttachmentToken } from "../sessionViewerUtils";
import { CollabIcon, CollabIconButton } from "./CollabIcon";
import { describeMeetingMember } from "./meetingDisplay";

interface Props {
  rootId: string;
  members: CollabMemberSlot[];
  agents: AgentStatus[];
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string) => Promise<void>;
}

export function MeetingComposer({ rootId, members, agents, disabled, placeholder = "补充议题，或输入 @ 点名成员", onSend }: Props) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [suggest, setSuggest] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const mention = suggest ? text.slice(0, cursor).match(/(?:^|[\s\p{Script=Han}([（【，。！？])[@＠]([^\s@＠]*)$/u) : null;
  const matches = mention ? members.map((member, index) => ({
    id: member.slot_id, ...describeMeetingMember(member, index, agents),
  })).filter(({ title, label }) => `${title} ${label}`.toLowerCase().includes(mention[1].toLowerCase())) : [];
  const busy = disabled || sending;

  async function send() {
    if (busy || (!text.trim() && files.length === 0)) return;
    setSending(true);
    setError("");
    try {
      let attachments: string[] = [];
      if (files.length) {
        controller.current = new AbortController();
        const uploaded = await uploadFiles({ rootId, files, onProgress: setProgress, signal: controller.current.signal });
        attachments = uploaded.map((file) => formatUploadAttachmentToken(file.agent_path || file.path)).filter(Boolean);
        setProgress(null);
        setFiles([]);
        setText([text.trim(), ...attachments].filter(Boolean).join("\n"));
      }
      await onSend([text.trim(), ...attachments].filter(Boolean).join("\n"));
      setText("");
      setFiles([]);
      setSuggest(false);
    } catch (error) {
      if (!isUploadAbortError(error)) setError(error instanceof Error ? error.message : "发送失败");
    } finally {
      controller.current = null;
      setSending(false);
      setProgress(null);
    }
  }

  function selectMember(alias: string) {
    if (!mention) return;
    const position = cursor - mention[1].length - 1;
    const inserted = "@" + alias + " ";
    setText(text.slice(0, position) + inserted + text.slice(cursor));
    setSuggest(false);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(position + inserted.length, position + inserted.length);
    });
  }

  return <form className="meeting-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <textarea
      ref={editor} aria-label="会议补充" placeholder={placeholder} rows={2}
      value={text} disabled={busy}
      onChange={(event) => {
        setText(event.currentTarget.value);
        setCursor(event.currentTarget.selectionStart);
        setSuggest(true);
      }}
      onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
      onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files);
        if (pasted.length > 0) {
          event.preventDefault();
          setFiles((current) => [...current, ...pasted]);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setSuggest(false);
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void send();
        }
      }}
    />
    {matches.length > 0 && <div className="meeting-mentions" aria-label="点名成员">
      {matches.map(({ id, agent, alias, label, title }) => <button type="button" key={id} title={title}
        onClick={() => selectMember(alias)}><AgentIcon agentName={agent} aria-hidden="true" />{label}</button>)}
    </div>}
    {files.length > 0 && <div className="collab-attach-files">
      {files.map((file, index) => <span className="collab-attach-file-chip" key={index}>
        <span className="collab-attach-file-name" title={file.name}>{file.name}</span>
        <CollabIconButton icon="close" label={`移除 ${file.name}`} className="collab-attach-file-remove"
          disabled={busy} onClick={() => setFiles(files.filter((_, i) => i !== index))} />
      </span>)}
    </div>}
    <CompactUploadProgress progress={progress} label="正在上传附件" statusLabel="上传中" cancelLabel="取消上传"
      onCancel={() => controller.current?.abort()} />
    {error && <span role="alert" className="meeting-error">{error}</span>}
    <div className="meeting-composer-actions">
      <input ref={picker} type="file" multiple hidden aria-label="会议附件" onChange={(event) => {
        const picked = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = "";
        setFiles((current) => [...current, ...picked]);
      }} />
      <CollabIconButton icon="attach" label="附件" disabled={busy} onClick={() => picker.current?.click()} />
      <button type="submit" className="collab-btn-secondary" disabled={busy || (!text.trim() && !files.length)}>
        <CollabIcon name="send" />{sending ? "发送中…" : "发送"}
      </button>
    </div>
  </form>;
}
