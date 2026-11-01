---
doc_type: issue-fix
status: fixed-pending-user-validation
severity: high
tags: [remote-access, shared-host, upgrade]
---

# 升级后节点首页仍使用旧页面

## 现场证据

用户使用 `0.1.25-local.3`，报告从 A/B 进入各自只能看到当前项目，从节点首页看不到项目。
只读检查用户提供的 Relay 节点：节点首页引用 `index-T9Cn5Ps_.js`，SHA256 为
`ed552661ee1ee3cd953524fde00c19e7bad8a051c925600a923d3f8fcd52828c`，与 local.1 包一致；
项目入口引用 `index-BM5hCgwQ.js`，与 local.3 包一致。
旧首页没有挂载 RemoteHostShell，空项目页根因得到确认。

共享 Host 独立于 IDEA 项目存活，旧 supervisor 只检查健康与协议号，不检查插件版本。
升级后的项目进程服务新页面，但继续复用旧 Host，而旧 Host 从旧内容哈希目录服务首页。
因此刷新浏览器无法修复。A/B 的具体点击位置尚未收到补充证据，不能据此断言用户所说的“新增”就是顶部项目切换。

## 修复

- Host 报告启动插件版本。supervisor 在跨进程升级锁内比较版本；本地包按序号比较，正式版高于同版本本地包，不降级其他 IDEA 已启动的新 Host。
- 新 Host 提供仅本地控制端可调用的认证升级退出接口，要求精确匹配观察到的版本，不修改全局启用偏好、绑定、项目记录或密钥。
- 已发布 local.1–3 未提供版本和退出接口：只定位认证控制地址对应的精确 loopback 监听 PID，校验缓存目录、完成标记、可用的进程参数和启动时间，复核后停止该 Host。绝不按进程名批量停止。Windows 使用系统 netstat，macOS 使用 lsof。
- 自动启动新 Host，各项目进程自行重新登记；Agent 运行与会话仍由原项目进程持有。
- 增补真实打包入口测试：A → B → 全部项目 → 首页刷新，始终可见 A/B，无需重新输入凭据。

## 验证与边界

- Go 多进程测试：旧 Host、两个独立项目、加密请求和 WS；替换 Host 后 B 的原加密会话继续工作，项目目录与身份不变，新首页资源生效，节点凭据文件逐字节不变。
- Go 本地控制接口：拒绝无凭据、错误版本和公网调用；合法升级不会禁用节点。app/remotehost race 通过。
- Kotlin：版本排序、禁止降级、监听端口精确匹配、拒绝项目进程参数、不完整缓存拒绝、认证升级退出。
- 在 macOS 用独立临时目录和真实 runtime 验证无版本 Host 自动替换，旧进程退出、密钥保留、新版本被复用。没有停止或修改用户真实后台。
- 浏览器真实构建入口与项目目录相关测试 8/8 通过；kanban 全量和旧库迁移 race 通过。
- Windows 的进程识别路径有解析和身份校验测试；本机不是 Windows，仍需用户安装测试包验证实际 Windows 进程替换及 A/B 点击路径。

不要求删除节点或重新绑定。不提交、push 或发布市场。

## 本地测试包

- `build/local-packages/idea-ai-agent-0.1.25-local.4-windows-amd64.zip`，12,419,131 字节。
- SHA256：`4be515050b358755dc18d0c9e032b734bd960ea4cced3802c3ce3e452ff3e294`。
- Go server 全量通过，Kotlin 75/75 无跳过，TypeScript、构建和插件配置检查通过。
- ZIP 内 278 个前端文件与当前 dist 完全一致，插件版本和升级类已核对；从 ZIP 解出的实际页面再次通过 A/B 切换、返回首页和刷新列表测试。
- 结构化核对报告：`build/reports/remote-host-upgrade-package.json`。
