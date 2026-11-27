const GROUP_TITLE = "协作记录的存储与迁移";
const GROUP_TOPIC = "为「开大会」设计记录存储方案。沿用现有会话数据，旧项目升级后须能正常读取，后台重启后可继续讨论。";
const GROUP_MEMBERS = [
  { agent: "codex", model: "gpt-5.4", effort: "high" },
  { agent: "claude", model: "claude-opus-4-6", effort: "high" },
  { agent: "gemini", model: "gemini-2.5-pro", effort: "high" },
];
const GROUP_PROPOSALS = [
  {
    summary: "复用现有会话库，项目内保留交接文档。",
    body: "我建议在现有会话库增加会议状态。每个成员的提交和轮次进度一起保存，后台重启时能判断哪些成员需要继续。交接文档仍放在项目内，原生工具可以直接读取。\n\n具体做法分三步：第一，会议、轮次、成员提交三张表放进现有会话库，沿用已有的幂等迁移入口，旧项目升级时只补缺的表和列，不删表重建。第二，成员交卷时先写项目内文件，再把状态改为已提交；重启后以文件为准补齐状态。第三，清理只按本次会议的运行范围执行，已有会话不受影响。\n\n需要补的测试：缺列的旧库能正常读写、重复迁移不报错、文件已写好但状态没更新时重启能恢复。",
    source: "runtime/server/internal/collab/store.go",
  },
  {
    summary: "复用会话库，加一条文档写入与状态提交顺序。",
    body: "我查了现有的交接文件写入。文件写成功后才把成员标为已提交，重启时也要能分辨文件已经写好但状态还没更新的情况。这样不会把一份交接漏掉。",
    source: "runtime/server/internal/collab/handoff_docs.go",
  },
  {
    summary: "建议给会议记录单独建库，独立管理它的生命周期。",
    body: "我倾向于单独保存会议状态，避免会议记录和已有会话共用清理规则。代价是需要额外处理新库的迁移与恢复，尤其是启动过程中两个库存活状态不一致时。",
    source: "runtime/server/internal/session/manager_db.go",
  },
];
const GROUP_REVIEWS = [
  {
    agree: "检查了现有迁移入口。旧项目应能重复运行迁移，已有会话需要保留。剩余风险是缺列的旧库能否正常启动。",
    first: "优先复用会话库。清理边界可以通过独立的会议记录表管理，新数据库会增加启动与恢复路径。",
    later: "同意复用会话库并用独立的会议表管理清理范围。重启恢复仍需要覆盖文件已存在、成员状态未更新的用例。",
  },
  {
    agree: "核对了项目内文件写入流程。每个成员的交接文件应先写成功，再更新提交状态。剩余风险是写入后立即中断。",
    first: "我支持复用会话库，同时希望在测试中覆盖落盘和提交状态之间的中断。",
    later: "同意在这次实施里补旧库迁移和写入中断两项回归。首次启动时的迁移日志仍需明确显示失败原因。",
  },
  {
    agree: "检查了会话清理入口。清理必须按运行范围执行。剩余风险是旧会话被误纳入清理范围。",
    first: "建议独立库。若继续使用现有库，需要说明会议材料的清理范围和回归用例。",
    later: "接受复用会话库。只按本次会议记录和文档范围清理，并加入已有会话保留的测试用例。",
  },
];
const groupSetup = { members: GROUP_MEMBERS.map(member => ({ ...member })), author: 1, topic: GROUP_TOPIC, modified: false };
let group;
let groupTimer;
let groupDemoID = 0;

function groupIcon(name, size = 16) {
  const paths = {
    file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"/><path d="M13 3v7h7M8 14h8m-8 3h6"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 8a7 7 0 0 1 11.7-2.1L20 9m-16 6 2.7 3.1A7 7 0 0 0 18.4 16"/>',
    clip: '<path d="m20 11-8.2 8.2a4.5 4.5 0 0 1-6.4-6.4l9.2-9.2a3 3 0 0 1 4.2 4.2l-9.2 9.2a1.5 1.5 0 0 1-2.1-2.1l8.5-8.5"/>',
  };
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
}

function groupMemberName(member) {
  const names = { codex: "Codex", claude: "Claude", gemini: "Gemini" };
  const matchingMembers = group.members.filter(item => item.agent === member.agent);
  const number = matchingMembers.indexOf(member) + 1;
  return names[member.agent] + (matchingMembers.length > 1 ? " " + number : "");
}

function roundFolder(round) {
  return "第" + String(round.number).padStart(2, "0") + "轮";
}

function groupRound() {
  return group.rounds[group.view - 1];
}

function activeGroupRound() {
  return group.rounds.at(-1);
}

function registerGroupDoc(file, body, round) {
  const key = group.id + "/" + (round ? roundFolder(round) + "/" : "") + file;
  DOCS[key] = { name: file.split("/").at(-1), path: ".mindfs/runs/" + key, body };
  return key;
}

function groupFileButton(key, label) {
  const doc = DOCS[key];
  return '<button type="button" class="group-file" data-doc="' + escapeHtml(key) + '" onclick="openDoc(this.dataset.doc)">' +
    groupIcon("file", 15) + '<span>' + escapeHtml(label || doc.name) + '</span></button>';
}

function downloadPrototypeDoc(doc) {
  const url = URL.createObjectURL(new Blob([doc.body], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function makeGroupRound(number, inputs) {
  const round = { number, inputs, phase: number === 1 ? "proposal" : "review", paused: false, members: [], notes: [], noteDraft: "" };
  round.discussionOpen = {};
  round.members = group.members.map((member, index) => {
    const streamKey = "group-" + group.id + "-" + number + "-" + index;
    STREAMS[streamKey] = {
      title: groupMemberName(member) + " · 第 " + number + " 轮",
      ...member,
      mode: "只读",
      activity: number === 1 ? "准备独立提案" : "准备互评",
      events: [],
    };
    return { streamKey, member, proposal: null, review: null, inspectedOtherDraft: false };
  });
  return round;
}

function initGroupPrototype() {
  resetGroup(GROUP_TOPIC, GROUP_MEMBERS, 1, true);
}

function resetGroup(topic, members, author, completed) {
  clearTimeout(groupTimer);
  groupTimer = null;
  const title = topic === GROUP_TOPIC ? GROUP_TITLE : topic.split("\n")[0];
  group = {
    id: "run-043-demo-" + (++groupDemoID),
    title, topic, members: members.map(member => ({ ...member })), author,
    view: 1, rounds: [], attachments: [], plan: null,
  };
  group.topicDoc = registerGroupDoc("00-会议议题.md", "# 会议议题\n\n" + topic + "\n");
  const round = makeGroupRound(1, [group.topicDoc]);
  group.rounds.push(round);
  if (completed) {
    round.members.forEach((entry, index) => {
      deliverProposal(round, entry, index);
      deliverReview(round, entry, index);
    });
    finishGroupRound(round);
  }
}

function deliverProposal(round, entry, index) {
  const { summary, body, source } = GROUP_PROPOSALS[index];
  const name = groupMemberName(entry.member);
  entry.proposal = registerGroupDoc("01-独立提案/" + name + ".md", "# " + name + " 的独立提案\n\n" + body + "\n\n依据：" + source + "\n", round);
  entry.summary = summary;
  entry.body = body;
  entry.source = source;
  const stream = STREAMS[entry.streamKey];
  stream.docKey = entry.proposal;
  stream.activity = "独立提案已落盘";
  stream.events.push(
    { kind: "tool", name: "read_file · " + source, out: "检查现有读写与恢复流程。" },
    { kind: "agent", text: body + "\n\n阶段交付路径：" + DOCS[entry.proposal].path },
  );
  if (index === 2) {
    entry.inspectedOtherDraft = true;
    stream.events.push({
      kind: "tool", name: "read_file · " + DOCS[round.members[0].proposal].path,
      out: "盲评期间读取了其他成员的草案。此条记录供作者判断该草案是否采信。",
    });
  }
}

function deliverReview(round, entry, index) {
  const review = GROUP_REVIEWS[index];
  const name = groupMemberName(entry.member);
  const position = round.number === 1 ? review.first : review.later;
  entry.agreement = review.agree;
  entry.position = position;
  entry.review = registerGroupDoc("02-互评/" + name + ".md", "# " + name + " 的互评\n\n## C1 旧库升级\n" + review.agree + "\n\n## D1 会议记录的存储位置\n" + position + "\n", round);
  const stream = STREAMS[entry.streamKey];
  stream.docKey = entry.review;
  stream.activity = "本轮互评已落盘";
  if (round.number > 1) {
    stream.events.push({
      kind: "tool",
      name: "读取上一轮交接材料",
      out: round.inputs.map(key => DOCS[key].path).join("\n"),
    });
  }
  stream.events.push({ kind: "agent", groupReview: true, text: review.agree + "\n\n" + position + "\n\n阶段交付路径：" + DOCS[entry.review].path });
}

function finishGroupRound(round) {
  round.phase = "ready";
  round.paused = false;
  round.aligned = round.number > 1 && round.members.every(entry => entry.review);
  const opinions = (field) => round.members.map(entry => {
    const value = entry[field] || (entry.proposal ? "已提交独立提案，本轮互评未提交。" : "本轮未提交。");
    const reference = entry.review || entry.proposal;
    return "- " + groupMemberName(entry.member) + "：" + value + (reference ? "\n  出处：" + DOCS[reference].path : "");
  }).join("\n");
  round.handoff = registerGroupDoc("03-共识与分歧.md",
    "# 第 " + round.number + " 轮共识与分歧\n\n## C1 旧库升级\n" + opinions("agreement") +
    "\n\n## D1 会议记录的存储位置 · " + (round.aligned ? "已对齐" : "待讨论") + "\n" + opinions("position") + "\n", round);
}

function advanceGroupRound() {
  groupTimer = null;
  const round = activeGroupRound();
  if (round.paused || round.phase === "ready") return;
  const isProposal = round.phase === "proposal";
  const index = round.members.findIndex(entry => !entry[isProposal ? "proposal" : "review"]);
  if (isProposal) deliverProposal(round, round.members[index], index);
  else deliverReview(round, round.members[index], index);
  const complete = index === round.members.length - 1;
  if (complete && isProposal) round.phase = "review";
  if (complete && !isProposal) finishGroupRound(round);
  if (state.scene === "group-chat") {
    const input = $("abInput");
    const selection = input && document.activeElement === input && [input.selectionStart, input.selectionEnd];
    render();
    if (selection) {
      $("abInput").focus({ preventScroll: true });
      $("abInput").setSelectionRange(...selection);
    }
  } else updateGroupSidebar();
  scheduleGroupProgress();
}

function scheduleGroupProgress() {
  const round = activeGroupRound();
  if (groupTimer || round.paused || round.phase === "ready") return;
  groupTimer = setTimeout(advanceGroupRound, 1050);
}

function restartGroupDemo() {
  resetGroup(GROUP_TOPIC, GROUP_MEMBERS, 1, false);
  switchScene("group-chat");
  scheduleGroupProgress();
}

function startGroupPrototype() {
  const topic = groupSetup.topic.trim();
  if (!topic) { $("groupTopic").focus(); return; }
  resetGroup(topic, groupSetup.members, groupSetup.author, false);
  switchScene("group-chat");
  scheduleGroupProgress();
}

function selectGroupStream() {
  const round = groupRound();
  if (state.sel === group.plan?.streamKey && group.view === group.rounds.length) return;
  if (!round.members.some(entry => entry.streamKey === state.sel)) state.sel = round.members[group.author].streamKey;
}

function viewGroupRound(number) {
  const fold = document.getElementById("g-fold-" + number);
  if (fold) { fold.open = true; fold.scrollIntoView({ block: "start" }); return; }
  const marker = document.getElementById("g-round-" + number);
  if (marker) marker.scrollIntoView({ block: "start" });
}

function checkGroupProgress() {
  const round = activeGroupRound();
  if (round.phase === "ready") {
    showToast("本轮已交接，等你决定下一步");
    return;
  }
  if (round.paused) {
    round.paused = false;
    render();
    scheduleGroupProgress();
    showToast("已恢复当前阶段");
    return;
  }
  scheduleGroupProgress();
  showToast("当前阶段正在推进");
}

function openGroupSupplement() {
  const input = $("abInput");
  if (input) input.focus();
}

function setGroupAttachments(input) {
  group.attachments = Array.from(input.files, file => file.name);
  $("groupAttachmentNames").textContent = group.attachments.join("、");
}

function saveGroupSupplement(text) {
  const round = activeGroupRound();
  if (group.plan?.confirmed) return;
  clearTimeout(groupTimer);
  groupTimer = null;
  if (round.phase !== "ready") round.paused = true;
  if (group.plan) group.plan = null;
  const attachmentNames = group.attachments;
  group.attachments = [];
  round.notes.push({ text, attachments: attachmentNames });
  round.noteDraft = "";
  round.chat = round.chat || [];
  const after = groupDelivered(round).length;
  const target = round.members.find(entry => text.includes("@" + groupMemberName(entry.member)));
  const item = { text, attachments: attachmentNames, after };
  if (target) {
    const name = groupMemberName(target.member);
    item.entry = target;
    item.reply = "我重新核对了 " + target.source + "，这部分在我的提案里没有变化。若你想换一种做法，请补充材料，我会在下一轮按新材料重新评估。";
    item.doc = registerGroupDoc("04-补充答复/" + name + ".md", "# " + name + " 对作者点名的答复\n\n问：" + text + "\n\n答：" + item.reply + "\n", round);
    round.replies = round.replies || [];
    round.replies.push(item.doc);
    STREAMS[target.streamKey].events.push({ kind: "user", text }, { kind: "agent", text: item.reply + "\n\n阶段交付路径：" + DOCS[item.doc].path });
  } else {
    round.members.forEach(entry => STREAMS[entry.streamKey].events.push({ kind: "user", text: [text, attachmentNames.join("、")].filter(Boolean).join("\n") }));
  }
  round.chat.push(item);
  round.supplement = registerGroupDoc("04-作者补充.md", "# 作者补充\n\n" + round.notes.map(note =>
    note.text + (note.attachments.length ? "\n\n附件：" + note.attachments.map(name => "附件/" + name).join("、") : "")).join("\n\n---\n\n") + "\n", round);
  render();
  showToast(target ? "已点名 " + groupMemberName(target.member) + "，答复已落盘" : "已保存 04-作者补充.md");
}

function startNextGroupRound() {
  const current = activeGroupRound();
  if (current.phase !== "ready" && !(current.paused && current.supplement)) return;
  if (current.phase !== "ready") finishGroupRound(current);
  const inputs = [group.topicDoc, current.handoff, current.supplement, ...(current.replies || [])].filter(Boolean);
  const first = group.rounds[0];
  inputs.push(...first.members.map(entry => entry.proposal).filter(Boolean));
  const next = makeGroupRound(current.number + 1, inputs);
  group.plan = null;
  group.attachments = [];
  group.rounds.push(next);
  group.view = next.number;
  state.cardsScroll = 0;
  state.level = "cards";
  selectGroupStream();
  render();
  scheduleGroupProgress();
}

function writeGroupPlan() {
  const round = activeGroupRound();
  if (!round.aligned) return;
  if (group.plan) { openDoc(group.plan.key); return; }
  const lead = group.members[group.author];
  const leadName = groupMemberName(lead);
  const supplements = group.rounds.filter(item => item.supplement);
  const notes = supplements.flatMap(item => item.notes).map(note => note.text).filter(Boolean);
  const sources = [round.handoff, ...supplements.map(item => item.supplement)];
  const body = "# " + group.title + "\n\n## 目标\n" + group.topic +
    "\n\n## 实施计划\n1. 在现有会话库添加会议、轮次与成员提交记录。\n2. 先写项目内交接文件，再更新提交状态。后台重启后按已有文件和状态恢复。\n3. 清理按会议运行范围执行，保留已有会话。\n\n" +
    "## 验收\n- 旧库可重复迁移，已有会话可读。\n- 模拟文件已写、提交状态尚未更新的中断，并验证恢复。\n- 验证只清理指定会议的相关记录。\n\n" +
    (notes.length ? "## 作者补充\n" + notes.join("\n\n") + "\n\n" : "") +
    "## 共识与分歧\nD1 已对齐，采用现有会话库。\n\n" +
    "## 交接依据\n" + sources.map(key => "- " + DOCS[key].path).join("\n") +
    "\n\n## 成员核对\n" + group.members.filter(member => member !== lead).map(member => "- " + groupMemberName(member) + "：已确认").join("\n") + "\n";
  const key = registerGroupDoc("05-正式计划.md", body);
  const streamKey = "group-" + group.id + "-plan";
  STREAMS[streamKey] = {
    ...lead, title: leadName + " · 正式计划", mode: "只读", activity: "正式计划已落盘，待你确认", docKey: key,
    events: [{ kind: "agent", text: "我已把这轮同意的存储方式、迁移要求和恢复用例整理成计划。旧会话保留和文件写入中断都列入了验收。\n\n阶段交付路径：" + DOCS[key].path }],
  };
  group.plan = { key, streamKey, confirmed: false };
  state.sel = streamKey;
  render();
  openDoc(key);
}

function confirmGroupPlan() {
  if (!group.plan || group.plan.confirmed) return;
  group.plan.confirmed = true;
  STREAMS[group.plan.streamKey].activity = "正式计划已确认";
  render();
  showToast("正式计划已确认");
}

function handoffGroupPlan() {
  const plan = group.plan;
  if (!plan?.confirmed) return;
  state.newRun.mode = "quick";
  state.newRun.handoff = { key: plan.key, title: group.title };
  state.newRun.task = DOCS[plan.key].body;
  switchScene("quick-start");
}

function renderHandoffSource() {
  const handoff = state.newRun.handoff;
  if (!handoff) return "";
  return '<div class="group-source"><div><strong>来自开大会</strong><div class="group-muted">将作为快速模式的 00-任务说明.md</div></div>' + groupFileButton(handoff.key) + '</div>';
}

function startQuickPrototype() {
  const handoff = state.newRun.handoff;
  if (!handoff) {
    switchScene("quick-review");
    toggleDemo();
    return;
  }
  const body = state.newRun.task;
  const key = "quick-handoff-task";
  DOCS[key] = { name: "00-任务说明.md", path: ".mindfs/runs/run-044-demo/00-任务说明.md", body };
  state.handoffQuickRun = { title: handoff.title, key };
  STREAMS["quick-handoff"] = {
    ...state.newRun.members[0], title: "快速模式 · 主模型实现", mode: "沿用 Agent 配置", activity: "已接收会议正式计划",
    events: [{ kind: "user", text: body }],
  };
  state.newRun.handoff = null;
  state.newRun.task = DEFAULT_QUICK_TASK;
  switchScene("quick-handoff");
}

function renderHandoffQuickRun() {
  const run = state.handoffQuickRun;
  return '<header class="pane-head"><div class="pane-head-left">' +
    '<button class="icon-btn hamburger" type="button" aria-label="运行列表" onclick="toggleSidebar(true)">' + groupIcon("menu") + '</button>' +
    '<span class="pane-title">' + escapeHtml(run.title) + '</span></div><span class="pane-sub">快速模式</span></header>' +
    '<div class="cards-scroll"><section class="t-card group-card">' +
      '<div class="group-card-title"><h2>主模型实现</h2><span class="group-muted">任务已接收</span></div>' +
      '<div class="group-source"><span>会议正式计划已写入本次任务说明</span>' + groupFileButton(run.key) + '</div>' +
    '</section></div>';
}

function renderGroupSetup() {
  const editor = groupSetup;
  return `
    <div class="group-setup-heading"><strong>会议成员</strong><span class="group-muted">全局模板 · 三方讨论</span></div>
    <div class="slot-row">
      ${editor.members.map((member, index) => `
        <div class="group-setup-slot">
          <button class="slot-card" type="button" onclick="openSlotPicker(${index})">
            <span class="group-muted">成员 ${index + 1} · 只读</span>
            <strong>${escapeHtml(member.agent)} / ${escapeHtml(member.model)}</strong>
            <span class="group-muted">思考强度 ${escapeHtml(member.effort)}</span>
          </button>
          <label><input type="radio" name="group-author" ${index === editor.author ? "checked" : ""} onchange="groupSetup.author=${index}"> 正式计划主笔</label>
        </div>`).join("")}
    </div>
    <div class="ab-box group-topic-box">
      <label for="groupTopic">会议议题</label>
      <textarea class="ab-input" id="groupTopic" oninput="groupSetup.topic=this.value">${escapeHtml(editor.topic)}</textarea>
      <div class="ab-foot"><button class="btn-primary" type="button" onclick="startGroupPrototype()">开始会议</button></div>
    </div>`;
}

function renderGroupMember(round, entry) {
  const name = groupMemberName(entry.member);
  const submitted = round.number === 1 ? entry.proposal : entry.review;
  const status = submitted ? "已落盘" : round.paused ? "暂停" : round.phase === "ready" ? "未提交" : "进行中";
  return `<li class="group-member">
    <button type="button" class="group-member-open ${entry.streamKey === state.sel ? "is-selected" : ""}" onclick="openCard('${entry.streamKey}')" aria-pressed="${entry.streamKey === state.sel}">
      <span class="group-member-mark" aria-hidden="true">${name.slice(0, 2)}</span>
      <span><strong>${escapeHtml(name)}</strong><span class="group-member-model">${escapeHtml(entry.member.model)}</span></span>
    </button>
    <div class="group-member-state">
      ${entry.inspectedOtherDraft ? '<button class="group-observed" type="button" onclick="openCard(\'' + entry.streamKey + '\')">读过他人草案</button>' : '<span class="group-muted">' + status + '</span>'}
      ${submitted ? groupFileButton(submitted, round.number === 1 ? "草案" : "互评") : ""}
    </div>
  </li>`;
}

function rememberGroupDiscussion(details, roundNumber) {
  group.rounds[roundNumber - 1].discussionOpen[details.dataset.item] = !details.open;
}

function openGroupReview(streamKey) {
  openCard(streamKey);
  const review = $("detailBody").querySelector("[data-group-review]");
  review.classList.add("group-review-selected");
  review.focus({ preventScroll: true });
  review.scrollIntoView({ block: "nearest" });
}

function renderGroupDiscussion(round, submitted, item) {
  const open = round.discussionOpen[item.id] ?? item.defaultOpen;
  return `<details class="group-dispute" data-item="${item.id}" ${open ? "open" : ""}>
    <summary onclick="rememberGroupDiscussion(this.parentElement, ${round.number})"><span class="group-issue-id">${item.id}</span><strong>${item.title}</strong><span class="${item.confirmed ? "group-positive" : "group-muted"}">${item.status}</span></summary>
    <div class="group-positions">${submitted.map(entry => {
      const name = escapeHtml(groupMemberName(entry.member));
      return `<div class="group-position">
        <strong>${name}</strong>
        <div class="group-position-actions">
          <button type="button" class="group-file" aria-label="查看 ${name} 的完整发言" onclick="openGroupReview('${entry.streamKey}')">看对话</button>
          ${groupFileButton(entry.review, "互评文件")}
        </div>
        <p>${escapeHtml(entry[item.field])}</p>
      </div>`;
    }).join("")}</div>
  </details>`;
}

function renderGroupPositions(round) {
  const submitted = round.members.filter(entry => entry.review);
  if (!submitted.length) return "";
  const complete = submitted.length === round.members.length;
  return `<section class="t-card group-card">
    <div class="group-card-title"><h2>共识与分歧</h2><span class="group-muted">${complete ? "1 项共识 · " + (round.aligned ? "分歧已对齐" : "1 项待讨论") : submitted.length + " 份互评已提交"}</span></div>
    ${renderGroupDiscussion(round, submitted, {
      id: "C1", field: "agreement", title: "旧库升级与交接写入", status: complete ? "3 同意 · 共识" : "待确认", confirmed: complete, defaultOpen: false,
    })}
    ${renderGroupDiscussion(round, submitted, {
      id: "D1", field: "position", title: "沿用会话库还是单独建库", status: round.aligned ? "3 同意 · 已对齐" : "2 同意 · 1 异议", confirmed: round.aligned,
      defaultOpen: round.number === 1 && state.viewport !== "phone" && innerWidth > 760,
    })}
  </section>`;
}

function groupAvatar(member) {
  const name = groupMemberName(member);
  return '<span class="g-avatar" data-agent="' + member.agent + '" aria-hidden="true">' + escapeHtml(name.slice(0, 2)) + '</span>';
}

function groupText(text) {
  const names = group.members.map(groupMemberName);
  let html = escapeHtml(text);
  names.forEach(name => {
    html = html.split("@" + name).join('<span class="g-mention">@' + name + "</span>");
  });
  return html.replace(/\n/g, "<br>");
}

function groupStance(round, index, kind) {
  if (kind === "proposal") return { label: "提出方案", tone: "info" };
  if (round.number > 1 || index !== 2) return { label: "同意 D1", tone: "ok" };
  return { label: "有异议 D1", tone: "warn" };
}

function groupDelivered(round) {
  const items = [];
  if (round.number === 1) {
    round.members.forEach((entry, index) => { if (entry.proposal) items.push({ kind: "proposal", entry, index }); });
  }
  round.members.forEach((entry, index) => { if (entry.review) items.push({ kind: "review", entry, index }); });
  return items;
}

function groupLink(key, label) {
  return '<button type="button" class="g-link" data-doc="' + escapeHtml(key) + '" onclick="openDoc(this.dataset.doc)">' + escapeHtml(label) + '</button>';
}

function groupMemberMessage(round, item) {
  const { entry, index, kind } = item;
  const name = groupMemberName(entry.member);
  const stance = groupStance(round, index, kind);
  let text;
  if (kind === "proposal") text = entry.body + "\n\n依据：" + entry.source;
  else {
    const prev = round.number > 1 && index > 0 ? "@" + groupMemberName(round.members[index - 1].member) + " " : "";
    text = prev + entry.agreement + "\n\n" + entry.position;
  }
  const file = kind === "proposal" ? entry.proposal : entry.review;
  return '<article class="g-msg">' + groupAvatar(entry.member) +
    '<div class="g-body"><div class="g-meta"><strong>' + escapeHtml(name) + '</strong><span>' + escapeHtml(entry.member.model) + '</span></div>' +
    '<div class="g-bubble"><div class="g-clamp">' + groupText(text) + '</div></div>' +
    '<div class="g-foot"><span class="g-stance g-' + stance.tone + '">' + stance.label + '</span>' +
    (kind === "proposal" && index === 2 ? '<span class="g-evidence g-warn" title="后台检查发现该出处在项目里找不到">出处 1 处查无此处</span>' : '<span class="g-evidence g-ok" title="后台已检查文件和行号存在">出处已核实</span>') +
    groupLink(file, kind === "proposal" ? "草案" : "互评") +
    '<button type="button" class="g-link" onclick="openCard(\'' + entry.streamKey + '\')">过程</button></div></div></article>';
}

function groupAuthorMessage(text, files, noteFile) {
  const foot = [];
  files.forEach(file => foot.push('<span>' + escapeHtml(file) + '</span>'));
  if (noteFile) foot.push('<span class="g-note-state">已记入 04-作者补充.md，下一轮读取</span>' + groupLink(noteFile, "查看"));
  return '<article class="g-msg is-me"><div class="g-body"><div class="g-bubble">' + groupText(text) + '</div>' +
    (foot.length ? '<div class="g-foot">' + foot.join("") + '</div>' : "") + '</div></article>';
}

function groupAskReply(ask) {
  const entry = ask.entry;
  return '<article class="g-msg">' + groupAvatar(entry.member) +
    '<div class="g-body"><div class="g-meta"><strong>' + escapeHtml(groupMemberName(entry.member)) + '</strong><span>回应你的点名</span></div>' +
    '<div class="g-bubble">' + groupText("@你 " + ask.reply) + '</div>' +
    '<div class="g-foot">' + groupLink(ask.doc, "答复") +
    '<button type="button" class="g-link" onclick="openCard(\'' + entry.streamKey + '\')">过程</button></div></div></article>';
}

function groupMarker(text, id, files) {
  return '<div class="g-marker"' + (id ? ' id="' + id + '"' : "") + '><span>' + escapeHtml(text) + '</span>' +
    (files && files.length ? '<div class="g-marker-files">' + files.map(key => groupLink(key, DOCS[key].name)).join("") + '</div>' : "") + '</div>';
}

function groupRoundStream(round) {
  const parts = [];
  const delivered = groupDelivered(round);
  const isFirst = round.number === 1;
  if (isFirst) {
    parts.push('<article class="g-msg is-me"><div class="g-body"><div class="g-bubble">' + groupText(group.topic) + '</div>' +
      '<div class="g-foot"><span>已邀请 ' + group.members.map(groupMemberName).join("、") + '</span>' + groupLink(group.topicDoc, "议题") + '</div></div></article>');
    parts.push(groupMarker("第 1 轮 · 独立提案 · 收齐前互相看不到", "g-round-1"));
  } else {
    const inputs = round.inputs.filter(key => key.indexOf("/01-独立提案/") < 0);
    parts.push(groupMarker("第 " + round.number + " 轮 · 轮流讨论 · 读取上一轮文件", "g-round-" + round.number, inputs));
  }
  const notes = round.chat || [];
  let revealed = false;
  const emitChat = count => notes.filter(item => item.after === count).forEach(item => {
    parts.push(groupAuthorMessage(item.text, item.attachments, round.supplement));
    if (item.reply) parts.push(groupAskReply(item));
  });
  emitChat(0);
  delivered.forEach((item, position) => {
    if (isFirst && !revealed && item.kind === "review") {
      parts.push(groupMarker("三份草案已收齐并公开 · 开始互评", ""));
      revealed = true;
    }
    parts.push(groupMemberMessage(round, item));
    emitChat(position + 1);
  });
  if (isFirst && !revealed && round.members.every(entry => entry.proposal)) parts.push(groupMarker("三份草案已收齐并公开 · 开始互评", ""));
  return parts;
}

function groupFoldSummary(round) {
  const total = round.members.length;
  const files = round.number === 1 ? total + " 份提案 · " + total + " 份互评" : total + " 份互评";
  const result = round.aligned ? "分歧已对齐" : "1 共识 · 1 分歧待讨论";
  return files + " · " + result;
}

function groupFoldedRound(round) {
  const files = [round.handoff, round.supplement, ...(round.replies || [])].filter(Boolean);
  return '<details class="g-round-fold" id="g-fold-' + round.number + '"><summary><strong>第 ' + round.number + ' 轮</strong><span>' + groupFoldSummary(round) + '</span></summary>' +
    '<div class="g-fold-body">' + groupRoundStream(round).join("") + (files.length ? groupMarker("本轮交接文件", "", files) : "") + '</div></details>';
}

function groupFlowIndex(round) {
  if (group.quick) return 4;
  if (group.plan) return 3;
  if (round.phase === "ready") return round.aligned ? 3 : 2;
  return round.phase === "proposal" ? 0 : 1;
}

function renderGroupFlow(round) {
  const names = ["提案", "互评", "对齐", "计划", "实现"];
  const current = groupFlowIndex(round);
  return '<ol class="g-flow" aria-label="会议进度">' + names.map((name, index) =>
    '<li class="' + (index < current ? "is-done" : index === current ? "is-now" : "") + '"' + (index === current ? ' aria-current="step"' : "") + '><i></i><span>' + name + '</span></li>').join("") + '</ol>';
}

function groupSpeaker(round) {
  if (group.quick) return "快速模式 · 主模型正在实现";
  if (round.phase === "ready") return "第 " + round.number + " 轮已收齐，等你决定";
  if (round.paused) return "已暂停，你的补充会带入下一轮";
  if (round.phase === "proposal") {
    const done = round.members.filter(entry => entry.proposal).length;
    return "独立提案中 " + done + "/" + round.members.length;
  }
  const next = round.members.find(entry => !entry.review);
  return next ? groupMemberName(next.member) + " 正在发言" : "正在收口";
}

function groupMeetingStream(round, plan, running) {
  const stream = [];
  group.rounds.forEach(item => {
    if (item === round) stream.push(...groupRoundStream(item));
    else stream.push(groupFoldedRound(item));
  });
  if (round.phase === "review" || round.phase === "ready") {
    const card = renderGroupPositions(round);
    if (card) stream.push('<div class="g-system">' + card + '</div>');
  }
  if (round.handoff || round.supplement) {
    stream.push(groupMarker("本轮交接文件，下一轮只读这些文件", "", [round.handoff, round.supplement].filter(Boolean)));
  }
  if (plan) {
    const lead = group.members[group.author];
    stream.push('<article class="g-msg">' + groupAvatar(lead) +
      '<div class="g-body"><div class="g-meta"><strong>' + escapeHtml(groupMemberName(lead)) + '</strong><span>正式计划主笔</span></div>' +
      '<div class="g-bubble">我把这轮对齐的结论整理成了正式计划，分歧和出处都保留在文件里。</div>' +
      '<div class="g-foot">' + groupLink(plan.key, "正式计划") +
      '<button type="button" class="g-link" onclick="openCard(\'' + plan.streamKey + '\')">过程</button></div></div></article>');
  }
  if (running) {
    const typing = round.phase === "proposal" ? "成员正在各自读代码、写提案" : groupSpeaker(round);
    stream.push('<div class="g-typing"><span></span><span></span><span></span><em>' + escapeHtml(typing) + '</em></div>');
  }
  return stream;
}

function renderGroupQuick(round) {
  const steps = ["主模型实现", "只读审核", "逐条回应", "作者裁决", "最终修改与测试"];
  const quick = group.quick;
  const meeting = '<details class="g-meeting-fold"><summary><strong>会议</strong><span>' + group.rounds.length + ' 轮 · 正式计划已确认</span></summary>' +
    '<div class="g-fold-body">' + groupMeetingStream(round, group.plan, false).join("") + '</div></details>';
  return meeting + '<section class="g-quick-run"><div class="g-quick-head"><h2>快速模式</h2><span>任务来自会议的正式计划</span>' +
    groupLink(quick.doc, "00-任务说明.md") + '</div>' +
    '<ol class="g-steps">' + steps.map((name, index) => '<li class="' + (index === 0 ? "is-run" : "") + '"><span class="g-step-no">' + (index + 1) + '</span><span class="g-step-name">' + name + '</span>' +
      '<span class="g-step-state">' + (index === 0 ? "进行中" : "等待") + '</span></li>').join("") + '</ol>' +
    '<button type="button" class="g-link" onclick="openCard(\'quick-handoff\')">查看主模型对话</button></section>';
}

function renderGroupChat() {
  const round = activeGroupRound();
  const plan = group.plan;
  const waiting = round.phase === "ready";
  const running = !group.quick && !waiting && !round.paused;
  const next = waiting || (round.paused && round.supplement);
  const status = groupSpeaker(round);
  const stream = group.quick ? [renderGroupQuick(round)] : groupMeetingStream(round, plan, running);
  const avatars = round.members.map(entry => {
    const submitted = round.number === 1 ? (round.phase === "proposal" ? entry.proposal : entry.review) : entry.review;
    const cls = group.quick ? "" : submitted ? "is-done" : running ? "is-running" : "";
    return '<button type="button" class="g-mini ' + cls + '" title="' + escapeHtml(groupMemberName(entry.member) + (entry.inspectedOtherDraft ? " · 读过他人草案" : "")) + '" onclick="openCard(\'' + entry.streamKey + '\')" aria-label="打开 ' + escapeHtml(groupMemberName(entry.member)) + ' 的原生对话">' +
      groupAvatar(entry.member) + (entry.inspectedOtherDraft ? '<i class="g-flag-dot"></i>' : "") + '</button>';
  }).join("");
  const lastKey = group.id + ":" + stream.length + ":" + (group.quick ? "q" : "m");
  const stick = group.lastKey !== lastKey;
  group.lastKey = lastKey;
  setTimeout(() => {
    document.querySelectorAll("#cardsPane .g-clamp").forEach(bubble => {
      if (bubble.dataset.checked) return;
      bubble.dataset.checked = "1";
      if (bubble.scrollHeight <= bubble.clientHeight + 1) return;
      const more = document.createElement("button");
      more.type = "button";
      more.className = "g-link g-more";
      more.textContent = "展开全文";
      more.onclick = () => { const open = bubble.classList.toggle("is-open"); more.textContent = open ? "收起" : "展开全文"; };
      bubble.after(more);
    });
    if (stick) { const box = document.querySelector("#cardsPane .g-scroll"); if (box) box.scrollTop = box.scrollHeight; }
  }, 0);
  const dotClass = group.quick ? "running" : running ? "running" : waiting && !plan?.confirmed ? "wait" : "";
  return '<header class="pane-head group-pane-head"><div class="pane-head-left">' +
    '<button class="icon-btn hamburger" type="button" aria-label="运行列表" onclick="toggleSidebar(true)">' + groupIcon("menu") + '</button>' +
    '<div class="group-heading"><h1 class="pane-title" title="' + escapeHtml(group.title).replace(/"/g, "&quot;") + '">' + escapeHtml(group.title) + '</h1></div></div>' +
    (group.quick ? '' : '<div class="group-round-controls"><select class="group-round-select" id="groupRoundPicker" aria-label="跳到会议轮次" onchange="viewGroupRound(Number(this.value))">' +
    group.rounds.map(item => '<option value="' + item.number + '" ' + (item === round ? "selected" : "") + '>第 ' + item.number + ' 轮</option>').join("") +
    '</select></div>') + '</header>' +
    '<div class="g-bar"><div class="g-status" role="status"><span class="run-dot ' + dotClass + '"></span><strong>' + escapeHtml(status) + '</strong>' +
    '<span class="g-avatars">' + avatars + '</span>' + (group.quick ? "" : renderGroupQuickControls(round, running, next)) + '</div>' + renderGroupFlow(round) +
    '<button type="button" class="g-topic-open" title="' + escapeHtml(group.topic).replace(/"/g, "&quot;") + '" onclick="openDoc(\'' + group.topicDoc + '\')"><span>议题</span><strong>' + escapeHtml(group.topic) + '</strong></button></div>' +
    '<div class="g-scroll" id="groupScroll"><div class="g-stream">' + stream.join("") + '</div></div>' +
    (group.quick ? "" : renderGroupFooter(round, plan, next) + renderGroupComposer());
}

function renderGroupQuickControls(round, running, next) {
  if (running) return '<button type="button" class="g-link" onclick="pauseGroup()">暂停</button>';
  if (round.paused && !next) return '<button type="button" class="g-link" onclick="checkGroupProgress()">继续</button>';
  return "";
}

function renderGroupFooter(round, plan, next) {
  if (plan) return '<div class="group-footer"><button class="btn-primary" type="button" onclick="startGroupImplementation()">确认并开始实现</button></div>';
  const buttons = [];
  if (next) buttons.push('<button class="' + (round.aligned ? "btn-secondary" : "btn-primary") + '" type="button" onclick="startNextGroupRound()">开始下一轮</button>');
  if (round.aligned) buttons.push('<button class="btn-primary" type="button" onclick="writeGroupPlan()">生成正式计划</button>');
  return buttons.length ? '<div class="group-footer">' + buttons.join("") + '</div>' : "";
}

function startGroupImplementation() {
  const plan = group.plan;
  if (!plan || group.quick) return;
  plan.confirmed = true;
  const body = DOCS[plan.key].body;
  const doc = registerGroupDoc("00-任务说明.md", body);
  DOCS[doc].path = ".mindfs/runs/run-044-demo/00-任务说明.md";
  STREAMS["quick-handoff"] = {
    ...group.members[group.author], title: "快速模式 · 主模型实现", mode: "沿用 Agent 配置", activity: "已接收会议正式计划",
    events: [{ kind: "user", text: "请读取项目文件 " + DOCS[doc].path + "，完成任务并自测。" }],
  };
  group.quick = { doc };
  state.sel = "quick-handoff";
  render();
  showToast("会议已收起，快速模式在当前页继续");
}

function renderGroupComposer() {
  const round = activeGroupRound();
  if (group.plan?.confirmed) return "";
  const mentions = group.members.map(member => '<button type="button" class="g-link" onclick="insertGroupMention(\'' + groupMemberName(member) + '\')">@' + escapeHtml(groupMemberName(member)) + '</button>').join("");
  return '<div class="actionbar"><div class="ab-box group-composer">' +
    '<div class="g-mention-row"><span class="group-muted">@ 点名</span>' + mentions + '</div>' +
    '<textarea id="abInput" class="ab-input" aria-label="在群里发言" placeholder="在群里发言。@ 某位成员让 TA 当场回答；不 @ 则记录并带入下一轮…" oninput="activeGroupRound().noteDraft=this.value" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendChat();}">' + escapeHtml(round.noteDraft || "") + '</textarea>' +
    '<div class="ab-foot"><div class="group-attachment"><label class="group-attachment-button" title="添加附件">' + groupIcon("clip", 17) +
    '<input type="file" id="groupAttachmentInput" multiple aria-label="添加附件" onchange="setGroupAttachments(this)"></label>' +
    '<span class="group-muted" id="groupAttachmentNames">' + escapeHtml(group.attachments.join("、")) + '</span></div>' +
    '<button class="btn-primary" type="button" onclick="sendChat()">发送</button></div></div></div>';
}

function insertGroupMention(name) {
  const input = $("abInput");
  if (!input) return;
  input.value = (input.value ? input.value.replace(/\s*$/, " ") : "") + "@" + name + " ";
  activeGroupRound().noteDraft = input.value;
  input.focus();
}

function pauseGroup() {
  const round = activeGroupRound();
  if (round.phase === "ready") return;
  round.paused = true;
  clearTimeout(groupTimer);
  groupTimer = null;
  render();
}

function updateGroupSidebar() {
  const round = activeGroupRound();
  const waiting = round.phase === "ready";
  const dot = $("groupRunDot");
  dot.className = "run-dot" + (group.plan?.confirmed ? "" : waiting || round.paused ? " wait" : " running");
  $("groupRunTitle").textContent = group.title;
  $("groupRunStatus").textContent = group.quick ? "大会 → 快速 · 主模型实现中" : "大会 · " + (group.plan?.confirmed ? "正式计划已确认" : waiting ? "第 " + round.number + " 轮待你确认" : round.paused ? "已暂停" : "第 " + round.number + " 轮进行中");
  const row = $("s-quick-handoff");
  row.hidden = !state.handoffQuickRun;
  if (state.handoffQuickRun) $("handoffRunTitle").textContent = state.handoffQuickRun.title;
}
