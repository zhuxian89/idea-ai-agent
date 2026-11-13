# Privacy Notice

Last updated: November 12, 2026

Local AI Agent is an open-source IntelliJ IDEA plugin. It does not include telemetry, analytics or advertising tracking. Local use does not require Relay; optional remote access connects the plugin to a Relay service after you enable it and link your computer (the unreleased multi-project implementation described below). Released version 0.1.25 uses separate project nodes.

## Data processed on your computer

The plugin processes the prompts, code, file paths, project paths, Agent responses, tool activity, model choices, and settings needed to provide its features. Conversation history and plugin settings are stored in the IntelliJ IDEA configuration directory under `idea-ai-agent/`. A bundled service runs on a random `127.0.0.1` port and accepts authenticated connections from the plugin UI.

The plugin can start supported Agent command-line tools with the current IDEA project as their working directory. Depending on the permission level you select, an Agent may read or change project files and run local commands.

## External services

Supported Agent CLIs may send prompts, code, tool results, account information, and related data to the model provider or endpoint configured in that CLI. Those transfers are controlled by the Agent CLI and are subject to the provider's terms and privacy policy. Optional remote access also transfers business traffic through Relay, as described below.

Agent installation or update commands run only after a user action and may connect to the package registries or download locations configured for that Agent. Links requested by an Agent are shown for confirmation before opening.

## Optional remote access

Remote access is off by default. The computer entry uses Relay's account and device-binding flow once per OS user. A plugin-managed local process owns the single outbound Relay connection and forwards requests to individually shared project runtimes; it does not create another Agent execution backend. Computer identity, node credentials and the project directory are stored in `%APPDATA%/LocalAIAgent/remote/` on Windows or `~/Library/Application Support/LocalAIAgent/remote/` on macOS. Project data remains in its existing IDEA configuration location. Opening a shared project starts its runtime automatically. Closing a project or disabling its remote access disconnects that project only; the computer switch disconnects all remote projects. The entry exits after the participating runtimes leave, including a bounded crash-detection/idle interval. Local use does not require a working remote entry.

Remote HTTP and WebSocket forwarding use the existing Relay without changing the cloud service or other connected clients. IDEA and the standalone backend do not require browser pairing, a pairing secret, or separate project authorization. Relay login protects the node list and binding flow; the current node-forwarding route does not check browser login. Anyone with the node URL can access its shared projects while remote access is enabled. Relay can read forwarded request bodies, responses, session messages, connection metadata, node identifiers, request paths, and query parameters. Public HTTPS/WSS encrypts traffic to Relay; the Relay-to-computer connector carries the forwarded traffic. Consult the Relay operator's terms and privacy policy for server retention.

The QR code, **Open browser** action and **Copy link** contain a node or project URL with optional project/session location. They do not contain pairing credentials. These node URLs can be opened directly.

Remote browsers can view project conversations and files, send Agent instructions, respond to approvals and edit files on disk, subject to the Agent's configured permissions. Browsers may retain file/session data in local storage or IndexedDB, plus static resources in service-worker caches. Text composer drafts are retained in session storage for project switches in the same browser tab; attachment contents are not persisted there. File editor drafts remain in page memory and switching away requires confirmation if they are unsaved. Unsaved IDEA editor buffers are not synchronized.

Turning remote access off disconnects remote browsers and retains local data. To remove a Relay binding, first disable access in the plugin and delete the node in Relay's node-management page. Clear the Relay site's browser data to remove cached content and any credentials retained by older versions; this can affect other nodes on the same site as well.

## Optional voice input

Microphone recording starts only after you choose a recording action and configure a speech service. The plugin keeps the recording in memory and, when you stop for transcription or reach the recording limit, sends WAV audio directly to your selected provider: Tencent Cloud, SiliconFlow, or your custom transcription endpoint. The configuration dialog's recording test also uploads audio to the provider currently selected in the form. These transfers are subject to that provider's terms, privacy policy, retention policy, and billing rules.

Recognition results are inserted into the conversation draft without automatically sending a message; test results appear only in the configuration dialog. Canceling a recording discards it. Canceling a transcription suppresses its result, but cannot recall audio already sent to a provider. The plugin does not save audio files or include audio in conversation history.

Speech service credentials are separate from Agent CLI credentials and stored in the IntelliJ IDEA Password Safe, separately for each speech provider. Non-secret provider settings are stored in the IDE configuration file `local-ai-agent-voice.xml`. You can change the provider and credentials in the plugin's voice configuration. The plugin vendor does not receive recordings or speech credentials.

## Retention and deletion

Local data remains until it is deleted through the plugin or removed from the IntelliJ IDEA configuration directory. Uninstalling the plugin may leave this data in place. Close all participating IDEA instances before manually removing the `idea-ai-agent/` directory from the relevant IDE configuration directory or the shared `LocalAIAgent/remote/` directory. Removing the shared remote directory removes the local computer identity and requires a new Relay binding; it does not remove project conversations. Remote browser copies and Relay account/node records are separate; remove them through browser site-data controls and Relay's management interface as described above.

## Contact

Questions and privacy reports can be filed through the [project issue tracker](https://github.com/zhuxian89/idea-ai-agent/issues).
