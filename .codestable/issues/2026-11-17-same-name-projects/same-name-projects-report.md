---
doc_type: issue-report
issue: 2026-11-17-same-name-projects
status: confirmed
severity: P1
summary: Windows 不同盘符下的同名项目无法同时接入独立后台
tags: [standalone, project-identity, windows]
---

# 不同路径同名项目无法同时使用

## 现象与复现

Windows 已管理 `Z:\java_project\ZHSZH-WZ-ZLJD`，再从 IDEA 打开 `D:\java_project\ZHSZH-WZ-ZLJD`，启动失败：`root name already exists`，要求重命名新目录。截图：`.mindfs/upload/2026-11-17/image.png`。

期望：用户明确选择“同时保留并使用两个项目”，两个物理目录各自接入并使用各自记录。

实际：第二个目录被拒绝，无法接入。现有源码在相同条件下固定进入拒绝分支；本轮尚未运行复现。

## 环境与优先级

独立后台的项目打开/注册功能，Windows，当前工作区基线 `c4d7a16` 且工作区干净。P1：阻断第二个项目的插件功能。问题涉及注册、元数据与移除/重命名的共同身份约定，采用标准分析记录。
