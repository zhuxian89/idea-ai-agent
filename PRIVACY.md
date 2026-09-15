# Privacy Notice

Last updated: September 15, 2026

Local AI Agent is an open-source IntelliJ IDEA plugin. The plugin vendor does not operate a hosted service for the plugin and does not collect telemetry, analytics, advertising identifiers, or usage data.

## Data processed on your computer

The plugin processes the prompts, code, file paths, project paths, Agent responses, tool activity, model choices, and settings needed to provide its features. Conversation history and plugin settings are stored in the IntelliJ IDEA configuration directory under `idea-ai-agent/`. A bundled service runs on a random `127.0.0.1` port and accepts authenticated connections from the plugin UI.

The plugin can start supported Agent command-line tools with the current IDEA project as their working directory. Depending on the permission level you select, an Agent may read or change project files and run local commands.

## External services

Local AI Agent does not send project data to a server operated by the plugin vendor. Supported Agent CLIs may send prompts, code, tool results, account information, and related data to the model provider or endpoint configured in that CLI. Those transfers are controlled by the Agent CLI and are subject to the provider's terms and privacy policy.

Agent installation or update commands run only after a user action and may connect to the package registries or download locations configured for that Agent. Links requested by an Agent are shown for confirmation before opening.

## Optional voice input

Microphone recording starts only after you choose a recording action and configure a speech service. The plugin keeps the recording in memory and, when you stop for transcription or reach the recording limit, sends WAV audio directly to your selected provider: Tencent Cloud, SiliconFlow, or your custom transcription endpoint. The configuration dialog's recording test also uploads audio to the provider currently selected in the form. These transfers are subject to that provider's terms, privacy policy, retention policy, and billing rules.

Recognition results are inserted into the conversation draft without automatically sending a message; test results appear only in the configuration dialog. Canceling a recording discards it. Canceling a transcription suppresses its result, but cannot recall audio already sent to a provider. The plugin does not save audio files or include audio in conversation history.

Speech service credentials are separate from Agent CLI credentials and stored in the IntelliJ IDEA Password Safe, separately for each speech provider. Non-secret provider settings are stored in the IDE configuration file `local-ai-agent-voice.xml`. You can change the provider and credentials in the plugin's voice configuration. The plugin vendor does not receive recordings or speech credentials.

## Retention and deletion

Data remains on the local machine until it is deleted through the plugin or removed from the IntelliJ IDEA configuration directory. Uninstalling the plugin may leave this data in place. Close IntelliJ IDEA before manually removing the `idea-ai-agent/` directory from the relevant IDE configuration directory.

## Contact

Questions and privacy reports can be filed through the [project issue tracker](https://github.com/zhuxian89/idea-ai-agent/issues).
