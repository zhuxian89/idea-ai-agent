---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: bug-06
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 06：左右视图错误解析空白增删行和连续符号

## 关键证据

- 新挂载点 `runtime/web/src/components/DiffCodeTable.tsx:73` 使用 `buildDiffLines(content)` 解析本轮补丁。
- `runtime/web/src/components/gitDiffModel.ts:47`：`/^\+[^+]/` 不匹配只有 `+` 的新增空行，也不匹配 `+++j;`（补丁前缀加代码 `++j;`）；删除行同理。

直接调用现有解析函数验证：

```text
输入：@@ -1,2 +1,3 @@ / " one" / "+" / " two"
实际：新增空行成为 {kind:"ctx", text:"+", oldLine:2, newLine:2}
实际：后续 two 的 oldLine 变成 3，正确值应为 2

输入：+++j;
实际：{kind:"ctx", text:"+++j;", ...}
```

## 影响

格式化插入/删除空行、Java/JS 前置自增自减等常见修改会被显示成两边都有的上下文，并使后续行号错位。缺陷原来存在于 Git 视图解析器，本次替换 Turn diff 的 Markdown 展示后也进入了本轮左右对比。

## 修复方向

解析时区分文件头和 hunk 内容，在 hunk 内按单字符前缀分类；保留正确行号并覆盖空行/连续符号/无末尾换行场景，建议 `cs-issue`。
