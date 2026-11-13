# 远程连接临时观测

用于定位“页面前台使用时频繁重连，刷新后暂时恢复”。保持产品的连接参数和业务代码，在独立 Gateway 与 Core 之间插入临时的本机代理。

- 代理直接转发升级后的 WebSocket 字节流。旁路解析小型 ping/pong 的 ID、方向、时间，以及大帧大小；不记录聊天正文、附件、Cookie 或令牌。
- 记录 WebSocket 握手进入/完成/失败；每 5 秒独立采样本机 Core/Gateway 控制接口及连接器连接状态，记录响应耗时、PID 和观测入口是否仍有效。该采样无需页面刷新，不代表已观察到连接器上游帧。
- 远程入口 HTML 注入诊断脚本。脚本记录 ping/pong、页面调用 `close()` 的时间、最后收包间隔、发送积压、事件循环延迟和前后台状态；按批上传到同一个本机代理。
- 失败时的未上传记录存入该标签页的 sessionStorage，刷新后继续上传。
- 只替换 `core.json` 的 `remote_url`，本地数据服务和 Gateway 保持运行；原描述符保存为仅当前用户可读的备份。停止或四小时到期时，只有描述符仍为本工具写入的版本才恢复，避免覆盖后续安装更新。
- 已经打开的页面要刷新一次才能加载诊断脚本。已建立的连接继续沿用原链路；新连接进入观测链路。

## 构建与启动

在 `runtime/` 执行：

```sh
go test -race ../scripts/diagnostics/reconnect/main.go ../scripts/diagnostics/reconnect/frames.go ../scripts/diagnostics/reconnect/health.go ../scripts/diagnostics/reconnect/main_test.go -run 'Test(FrameObserver|DiagnosticProxy)' -count=1
go build -o ../build/reports/reconnect-observer ../scripts/diagnostics/reconnect/main.go ../scripts/diagnostics/reconnect/frames.go ../scripts/diagnostics/reconnect/health.go
```

从仓库根启动，`--output` 使用本轮独立目录：

```sh
build/reports/reconnect-observer \
  -descriptor "$HOME/Library/Application Support/LocalAIAgent/remote/core.json" \
  -output "$HOME/Library/Application Support/LocalAIAgent/remote/diagnostics/reconnect-20261112" \
  -duration 4h
```

`observer.json` 记录 PID、监听地址和期限；`events.jsonl` 为诊断事件。向该 PID 发送 `SIGTERM` 可提前结束并恢复入口。若进程被 `SIGKILL`，须先核对当前 Core 身份，再用 `core.before.json` 恢复 `remote_url`，不要覆盖更新后的描述符。

`python3 scripts/diagnostics/reconnect/analyze.py /路径/events.jsonl` 可按客户端汇总两端心跳耗时及关闭事件。停止后刷新已打开的页面，即可移除该页中的临时诊断脚本。

## 判断方法

按浏览器 `event.client` 和 `event.probe` 关联 `core_socket.client/probe`：

1. `client_close` 携带约 2000 ms 的 `age_ms`：页面主动结束探测中的连接。
2. `to_core ping` 到 `from_core pong` 时间差：本机 Core 路径响应耗时。
3. Core 已及时回复，浏览器记录的 pong 明显较晚，且 `event_loop_delay` 或关闭时 `lag_ms` 升高：页面线程阻塞的证据。
4. 浏览器发送 ping，但本机未收到，或本机已回复而浏览器尚未处理、页面线程又未延迟：继续定位本机以外的传输段，不能据此认定 Core 阻塞。

浏览器与本机的系统时钟可能不同；优先比较同一时钟内的耗时并用探测 ID 对应，不能直接相减两端的绝对时间。
