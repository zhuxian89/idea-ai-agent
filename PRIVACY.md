# Privacy Notice

Last updated: October 29, 2026

Local AI Agent is an open-source IntelliJ IDEA plugin. It does not include telemetry, analytics or advertising tracking. Local use does not require Relay; optional remote access connects the plugin to a Relay service after you enable it and link a project.

## Data processed on your computer

The plugin processes the prompts, code, file paths, project paths, Agent responses, tool activity, model choices, and settings needed to provide its features. Conversation history and plugin settings are stored in the IntelliJ IDEA configuration directory under `idea-ai-agent/`. A bundled service runs on a random `127.0.0.1` port and accepts authenticated connections from the plugin UI.

The plugin can start supported Agent command-line tools with the current IDEA project as their working directory. Depending on the permission level you select, an Agent may read or change project files and run local commands.

## External services

Supported Agent CLIs may send prompts, code, tool results, account information, and related data to the model provider or endpoint configured in that CLI. Those transfers are controlled by the Agent CLI and are subject to the provider's terms and privacy policy. Optional remote access also transfers encrypted business traffic through Relay, as described below.

Agent installation or update commands run only after a user action and may connect to the package registries or download locations configured for that Agent. Links requested by an Agent are shown for confirmation before opening.

## Optional remote access

Remote access is off by default. Linking a project uses the configured Relay service's account and device-binding flow. When enabled, the plugin maintains an outbound connection to Relay, allowing paired browsers to access the same project backend and sessions. The enabled preference and node credentials are saved in that project's plugin configuration directory. Opening an enabled project in IDEA starts its connection automatically, even if the plugin panel is not opened. Closing the project or IDEA stops its runtime; disabling remote access disconnects remote clients without stopping local use.

The existing end-to-end encryption protocol protects remote business request bodies, responses and session WebSocket messages between the plugin runtime and paired browsers. Relay forwards that traffic and serves or forwards web resources. Connection metadata, node identifiers, request paths and query parameters, traffic sizes and timing remain visible to the Relay service. This notice does not specify or guarantee a Relay operator's server-log retention; consult the service's own terms and privacy policy.

The phone QR code contains the current pairing secret in a URL fragment. The browser reads it, removes that fragment from the address and saves the secret for future connections. The fragment is not sent as part of HTTP requests, but the QR code itself grants access and a scanning application may retain its contents. This is a reusable credential, not a one-time or expiring QR code. Ordinary copied links omit the secret and require pairing on first use.

Paired browsers can view project conversations and files, send Agent instructions, respond to approvals and edit files on disk, subject to the Agent's configured permissions. Browsers retain pairing secrets in local storage and may retain file/session data in local storage or IndexedDB, plus static resources in service-worker caches. Editor drafts remain in page memory rather than a persistent draft store. Unsaved IDEA editor buffers are not synchronized.

Turning remote access off does not erase browser data or revoke the saved pairing secret. To remove a Relay binding, first disable access in the plugin and delete the node in Relay's node-management page. Clear the Relay site's browser data on devices where you want to remove pairing information and cached content; this can affect other nodes on the same site as well.

## Optional voice input

Microphone recording starts only after you choose a recording action and configure a speech service. The plugin keeps the recording in memory and, when you stop for transcription or reach the recording limit, sends WAV audio directly to your selected provider: Tencent Cloud, SiliconFlow, or your custom transcription endpoint. The configuration dialog's recording test also uploads audio to the provider currently selected in the form. These transfers are subject to that provider's terms, privacy policy, retention policy, and billing rules.

Recognition results are inserted into the conversation draft without automatically sending a message; test results appear only in the configuration dialog. Canceling a recording discards it. Canceling a transcription suppresses its result, but cannot recall audio already sent to a provider. The plugin does not save audio files or include audio in conversation history.

Speech service credentials are separate from Agent CLI credentials and stored in the IntelliJ IDEA Password Safe, separately for each speech provider. Non-secret provider settings are stored in the IDE configuration file `local-ai-agent-voice.xml`. You can change the provider and credentials in the plugin's voice configuration. The plugin vendor does not receive recordings or speech credentials.

## Retention and deletion

Local data remains until it is deleted through the plugin or removed from the IntelliJ IDEA configuration directory. Uninstalling the plugin may leave this data in place. Close IntelliJ IDEA before manually removing the `idea-ai-agent/` directory from the relevant IDE configuration directory. Remote browser copies and Relay account/node records are separate; remove them through browser site-data controls and Relay's management interface as described above.

## Contact

Questions and privacy reports can be filed through the [project issue tracker](https://github.com/zhuxian89/idea-ai-agent/issues).
