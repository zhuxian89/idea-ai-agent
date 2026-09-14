import { useId, useMemo, type ReactNode } from "react";
import type { TimelineItem } from "../../hooks/useSessionStream";
import { useActivityGroupChoices } from "../../hooks/useActivityGroupChoices";
import { useActivityDisclosure } from "../../hooks/useActivityDisclosure";
import { useI18n } from "../../i18n";
import { projectActivityTimeline, type ActivityGroup } from "../../services/activityGrouping";
import { ToolActivityHeader } from "./ToolActivityHeader";
import "./ActivityTimeline.css";

function ActivityGroupHeader({ group, scope, expanded, detailsId, onToggle, spacing }: {
  group: ActivityGroup; scope: { rootId: string; sessionKey: string }; expanded: boolean;
  detailsId: string; onToggle: () => void; spacing: string;
}) {
  const { t, locale } = useI18n();
  const { focusProps } = useActivityDisclosure({ ...scope, callId: "", groupKey: group.key, defaultExpanded: false });
  const commandsOnly = group.items.every(item => item.operation === "execute");
  return <div {...focusProps} data-activity-reading="true" data-activity-group={group.key} style={{ marginTop: spacing }}>
    <ToolActivityHeader kind={commandsOnly ? "execute" : "other"} expanded={expanded} detailsId={detailsId} onToggle={onToggle}
      summary={t(commandsOnly ? "toolActivity.groupCommands" : "toolActivity.groupOperations", {
        count: new Intl.NumberFormat(locale).format(group.items.length),
      })} />
  </div>;
}

export function ActivityTimeline({ timeline, rootId, sessionKey, rootPath, tailClosed, renderItem, itemSpacing }: {
  timeline: readonly TimelineItem[]; rootId: string; sessionKey: string; rootPath?: string; tailClosed: boolean;
  renderItem: (item: TimelineItem, index: number, spacing: string) => ReactNode;
  itemSpacing: (previous: TimelineItem | null, current: TimelineItem) => string;
}) {
  const { locale } = useI18n();
  const id = useId();
  const projection = useMemo(() => projectActivityTimeline(timeline, { rootId, sessionKey, rootPath, locale, tailClosed }),
    [timeline, rootId, sessionKey, rootPath, locale, tailClosed]);
  const groups = useMemo(() => projection.rows.filter((row): row is ActivityGroup => row.type === "activity_group"), [projection]);
  const choices = useActivityGroupChoices(groups, { rootId, sessionKey });
  const memberId = (key: string) => `${id}-${encodeURIComponent(key)}`;
  const spacingAt = (index: number, item: TimelineItem) => itemSpacing(index > 0 ? timeline[index - 1] : null, item);
  const renderMember = (key: string, group?: ActivityGroup, expanded = true, first = false) => {
    const { item, index } = projection.originals.get(key)!;
    // Every member stays at the same parent and key when an open segment
    // becomes a group. Only explicit group collapse unmounts its content.
    return <div key={key} id={memberId(key)} data-activity-member={group?.key}
      className={group ? "activity-timeline-member activity-group-member" : "activity-timeline-member"} hidden={!expanded}>
      {expanded ? renderItem(item, index, group ? first ? "4px" : "2px" : spacingAt(index, item)) : null}
    </div>;
  };
  const rendered: ReactNode[] = [];
  for (const row of projection.rows) {
    if (row.type !== "activity_group") {
      rendered.push(renderMember(row.type === "boundary" ? row.key : row.view.key));
      continue;
    }
    const state = choices.get(row.key)!;
    const first = projection.originals.get(row.items[0].key)!;
    rendered.push(<ActivityGroupHeader key={row.key} group={row} scope={{ rootId, sessionKey }} expanded={state.expanded}
      detailsId={row.items.map(item => memberId(item.key)).join(" ")} onToggle={state.toggle} spacing={spacingAt(first.index, first.item)} />);
    row.items.forEach((item, index) => rendered.push(renderMember(item.key, row, state.expanded, index === 0)));
  }
  return <>{rendered}</>;
}
