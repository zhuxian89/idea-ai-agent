# JetBrains Marketplace listing

This file contains the values to use for the first Marketplace upload of Local AI Agent.

## General information

| Field | Value |
| --- | --- |
| Plugin for | IntelliJ Platform |
| Name | Local AI Agent |
| Plugin ID | `dev.ideaagent.local` |
| Vendor | Local AI Agent |
| Pricing | Free |
| License | GNU Affero General Public License v3.0 |
| License URL | https://github.com/zhuxian89/idea-ai-agent/blob/main/LICENSE |
| Source code | https://github.com/zhuxian89/idea-ai-agent |
| Documentation | https://github.com/zhuxian89/idea-ai-agent#readme |
| Issue tracker | https://github.com/zhuxian89/idea-ai-agent/issues |
| Privacy policy | https://github.com/zhuxian89/idea-ai-agent/blob/main/PRIVACY.md |
| Tags | AI, Code Tools, Productivity, Tools Integration |
| Supported IDE builds | 241 and later (IntelliJ IDEA 2024.1+) |
| Release channel | Default |

Use the public email attached to the JetBrains Vendor profile as the support email. The repository does not define a public support mailbox.

## Short summary

Native Agent workflows in IntelliJ IDEA, with zero reconfiguration when your CLI already works.

## Description

The canonical bilingual Marketplace description is in `src/main/resources/META-INF/plugin.xml`. English comes first because JetBrains requires the first 40 description characters and the primary listing language to be English; the complete Chinese description follows it.

JetBrains reads this description from an uploaded plugin ZIP. The currently approved version is 0.1.21, so use `docs/marketplace-description-0.1.21.html` to update its public page without advertising unreleased 0.1.22 features. In **General Information → Description**, choose **use the UI description until next update**. The next upload will then replace it with the canonical bilingual `plugin.xml` description.

## Getting Started

The approved page's Getting Started section is also English-only. For the current 0.1.21 page, paste `docs/marketplace-getting-started-0.1.21.html` into the Marketplace Getting Started field. It contains the same steps in English first and Simplified Chinese second, and only documents features available in 0.1.21.

## Version 0.1.22 change notes

The canonical change notes are also in `src/main/resources/META-INF/plugin.xml` and are included in the built ZIP.

## Reviewer notes

Local AI Agent starts a bundled local service on a random `127.0.0.1` port. The service is protected by an ephemeral token and exits with its IDEA project. Conversation data is stored locally in the IDEA configuration directory.

The plugin invokes supported Agent CLIs installed on the user's machine. Those CLIs may connect to model providers according to their existing configuration and authentication. Optional voice input records audio after a user action and uploads it directly to the configured Tencent Cloud, SiliconFlow, or custom speech endpoint for transcription. Speech credentials are stored separately in the IDE Password Safe. The plugin itself has no vendor-operated backend, telemetry, advertising, or paid feature.

GitHub Releases provide separate packages for Windows x64, Windows ARM64, macOS Apple Silicon, and macOS Intel. Upload `idea-ai-agent-0.1.22.zip` to Marketplace; it is the single universal plugin package and contains all four runtime executables. IDEA selects the matching executable when the plugin starts. IDEA 2024.x does not support Marketplace native variants.

This is an independent open-source project. It is not affiliated with JetBrains, OpenAI, or Anthropic.

## Media

Use screenshots with the default IDEA theme, no personal data, and a consistent 1280×800 canvas. Recommended feature order:

1. Conversation with streaming reply and tool activity.
2. Agent, model, reasoning effort, and execution permission controls.
3. Conversation history and Agent configuration.

The existing screenshots under `build/reports/` are test evidence and include fixture labels. Capture final Marketplace screenshots from an installed release build before submission.

## Upload checklist

- Build and verify all four supported runtime binaries.
- Confirm `pluginIcon.svg` is present under `META-INF` in the plugin JAR.
- Confirm the built `plugin.xml` contains the English-first bilingual description, 0.1.22 change notes, `since-build="241"`, and no `until-build` attribute.
- Install the release ZIP in IDEA 2024.1 and 2024.3 from disk.
- Capture final 1280×800 screenshots from the installed release build.
- Accept the JetBrains Marketplace Developer Agreement and declare trader or non-trader status.
- Create or select the Vendor profile and verify its public support email.
- Select AGPL-3.0 and provide the license, source, issue tracker, and privacy links above.
- Upload the ZIP to a hidden or custom channel first if another review round is needed.
