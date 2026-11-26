---
doc_type: issue-fix
issue: 2026-11-26-collab-handoff-docs
path: fast-track
fix_date: 2026-11-26
tags: [collab, handoff]
---

# 快速模式交接文档修复

## 问题和根因

合并逐条回应时，会直接采用主模型写到磁盘上的文档。文件正文未走聊天过滤器，机器控制块有机会进入用户可见的交接文档。最终报告则先落盘，再解析控制块中的测试命令，正文省略命令时文档无法直接复跑。

## 修复

`runtime/server/internal/collab/prompts.go` 在合并磁盘回应前复用控制块过滤器，覆盖 Agent 直接写入和历史文件续跑。`service.go` 在落盘前解析报告数据，交由 `stage_handoff.go` 把报告已记录、正文又缺少的命令作为 Markdown 代码补入。

## 验证

修复前分别复现控制块泄露与报告缺测试命令。修复后覆盖磁盘文档、历史续跑、多条测试命令和正文已有命令。隔离环境运行 `go test -race ./server/internal/collab ./server/internal/api ./server/internal/api/usecase -count=1`，三个包全部通过。[测试日志](../../../build/reports/collab-handoff-docs/go-race.log)

历史交付文件保留原样，修复随新构建用于后续生成的文档。
