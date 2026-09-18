---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: bug-07
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 07：新版 CredentialAttributes 构造器永远不会被选中

## 关键证据

- `src/main/kotlin/dev/ideaagent/VoiceSettings.kt:64` 同时要求 `parameterCount == 4` 和 `parameterTypes.contentEquals(legacy.copyOf(3))`；长度 4 的数组不可能等于长度 3 的数组。
- `legacy.copyOf(3)` 的元素还是 `String, String, Class`，与真实新签名 `String, String, boolean, boolean` 不符。
- 从本地 263.4732.28 的 `intellij.platform.credentialStore.jar` 反汇编确认，新 4 参数构造器存在，旧 5 参数兼容构造器也仍存在。

## 影响与边界

IDEA 2026.3 仍始终走反射调用旧构造器；Verifier 没警告是静态引用被反射隐藏，不能证明“新版本使用新 API”的兼容策略已经实现。当前 EAP 因保留旧构造器尚能运行；将来若仅保留新构造器，VoiceSettings 初始化会失败，并可能影响加载时安装 JCEF bridge。

## 修复方向

用真实 4 参数签名匹配，或验证可共用的公共重载并简化实现；加入跨版本构造器选择测试。建议 `cs-issue`，不能仅依赖静态 Verifier 结果验收此分支。
