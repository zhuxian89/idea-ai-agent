# Privacy Notice

Last updated: September 14, 2026

Local AI Agent is an open-source IntelliJ IDEA plugin. The plugin vendor does not operate a hosted service for the plugin and does not collect telemetry, analytics, advertising identifiers, or usage data.

## Data processed on your computer

The plugin processes the prompts, code, file paths, project paths, Agent responses, tool activity, model choices, and settings needed to provide its features. Conversation history and plugin settings are stored in the IntelliJ IDEA configuration directory under `idea-ai-agent/`. A bundled service runs on a random `127.0.0.1` port and accepts authenticated connections from the plugin UI.

The plugin can start supported Agent command-line tools with the current IDEA project as their working directory. Depending on the permission level you select, an Agent may read or change project files and run local commands.

## External services

Local AI Agent does not send project data to a server operated by the plugin vendor. Supported Agent CLIs may send prompts, code, tool results, account information, and related data to the model provider or endpoint configured in that CLI. Those transfers are controlled by the Agent CLI and are subject to the provider's terms and privacy policy.

Agent installation or update commands run only after a user action and may connect to the package registries or download locations configured for that Agent. Links requested by an Agent are shown for confirmation before opening.

## Retention and deletion

Data remains on the local machine until it is deleted through the plugin or removed from the IntelliJ IDEA configuration directory. Uninstalling the plugin may leave this data in place. Close IntelliJ IDEA before manually removing the `idea-ai-agent/` directory from the relevant IDE configuration directory.

## Contact

Questions and privacy reports can be filed through the [project issue tracker](https://github.com/zhuxian89/idea-ai-agent/issues).
