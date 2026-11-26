import React, { useEffect, useState } from "react";
import { collabService, type CollabFileTurn } from "../../services/collab";
import { TurnDiffSummary } from "../TurnDiffSummary";

type Props = { rootId: string; runId: string };

function FileTurns({ rootId, runId, path }: Props & { path: string }) {
  const [turns, setTurns] = useState<CollabFileTurn[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    collabService.fileTurns(rootId, runId, path).then(
      value => { if (current) setTurns(value); },
      err => { if (current) setError(String(err)); },
    );
    return () => { current = false; };
  }, [rootId, runId, path]);
  if (error) return <span role="alert">{error}</span>;
  if (!turns) return <span>正在读取差异…</span>;
  return turns.length ? <>{turns.map(turn => (
    <div key={`${turn.session_key}/${turn.seq}`}>
      <small>{turn.title}</small>
      <TurnDiffSummary update={turn.update} rootId={rootId} sessionKey={turn.session_key} initialFile={path} />
    </div>
  ))}</> : <span>没有记录到该文件的差异。</span>;
}

export function CollabFileChanges({ rootId, runId }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ paths: string[]; partial: boolean }>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!open || list) return;
    let current = true;
    setError("");
    collabService.changedFiles(rootId, runId).then(
      value => { if (current) setList(value); },
      err => { if (current) setError(String(err)); },
    );
    return () => { current = false; };
  }, [open, list, rootId, runId]);
  return (
    <details onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>本次改动文件{list ? `（${list.paths.length}）` : ""}</summary>
      {open ? <div>
        {error ? <span role="alert">{error}</span> : !list ? "正在读取文件清单…" : null}
        {list?.partial && <p>部分改动未能采集，请结合任务核对。</p>}
        {list?.paths.length === 0 && <p>本次记录未列出文件。</p>}
        {list?.paths.map(path => (
          <div key={path}>
            <button type="button" className="collab-quiet-link" aria-expanded={selected === path}
              onClick={() => setSelected(selected === path ? "" : path)}>{path}</button>
            {selected === path && <FileTurns rootId={rootId} runId={runId} path={path} />}
          </div>
        ))}
      </div> : null}
    </details>
  );
}
