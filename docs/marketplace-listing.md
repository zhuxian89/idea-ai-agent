# JetBrains Marketplace listing

This file contains the values to use for the JetBrains Marketplace listing of Local AI Agent.

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

Version 0.1.25 was uploaded to the default channel on 2026-10-29 as [update 1205662](https://plugins.jetbrains.com/plugin/34276-local-ai-agent/versions/stable/1205662). The upload and authenticated read-back succeeded; the update was pending JetBrains approval and not publicly listed at submission time.

Use the public email attached to the JetBrains Vendor profile as the support email. The repository does not define a public support mailbox.

## Short summary

Native Codex CLI and Claude Code in IntelliJ IDEA. Continue the same project from a browser or phone.

## Description

The canonical bilingual Marketplace description is in `src/main/resources/META-INF/plugin.xml`. English comes first because JetBrains requires the first 40 description characters and the primary listing language to be English; the complete Chinese description follows it.

JetBrains reads this description from the uploaded plugin ZIP. Version 0.1.25 includes the canonical bilingual description with shared remote sessions, phone pairing, automatic startup and browser file editing. `docs/marketplace-description-0.1.25.html` is the matching copy. The public listing may continue to show the previous approved description while the update is under review.

## Getting Started

Use `docs/marketplace-getting-started-0.1.25.html` for the Marketplace **Getting Started** field when 0.1.25 becomes available. It covers native Agent setup, optional voice and remote access. English is first and Simplified Chinese follows.

## Version 0.1.25 change notes

The canonical change notes are in `src/main/resources/META-INF/plugin.xml` and are included in the built ZIP. Version 0.1.25 adds remote access, automatic QR pairing, project startup, browser editing, pairing recovery and turn-ordering fixes. See `docs/releases/v0.1.25.md`.

## Reviewer notes

Local AI Agent starts a bundled local service on a random `127.0.0.1` port. The service is protected by an ephemeral token and exits with its IDEA project. Conversation data is stored locally in the IDEA configuration directory.

The plugin invokes supported Agent CLIs installed on the user's machine. Those CLIs may connect to model providers according to their existing configuration and authentication. Optional voice input records audio after a user action and uploads it directly to the configured Tencent Cloud, SiliconFlow, or custom speech endpoint for transcription. Speech credentials are stored separately in the IDE Password Safe. Optional remote access links to Relay and forwards encrypted business traffic; Relay sees connection metadata and request addresses, and browsers retain pairing credentials and caches. The plugin has no telemetry, advertising, or paid feature. See PRIVACY.md for the data-handling details.

GitHub Releases use separate packages for Windows x64, Windows ARM64, macOS Apple Silicon, and macOS Intel. Upload `idea-ai-agent-0.1.25.zip` to Marketplace; it is the single universal plugin package and contains all four runtime executables. IDEA selects the matching executable when the plugin starts. IDEA 2024.x does not support Marketplace native variants.

This is an independent open-source project. It is not affiliated with JetBrains, OpenAI, or Anthropic.

## Media

The next media direction is available locally in [the preview gallery](marketplace/index.html): native Agents, voice and attachments, fixed turn snapshots, and IDEA native Diff. The bilingual copy in [description-draft.html](marketplace/description-draft.html) is a draft for the next approved release, not the currently published description. Preview media uses real components with scripted data; replace the voice/agent sequence and native Diff handoff with an installed-build recording before publishing. See [production notes](marketplace/README.md).

Use screenshots with the default IDEA theme, no personal data, and a consistent 1280×800 canvas. Recommended feature order:

1. Native Codex CLI / Claude Code in IDEA, with existing CLI configuration.
2. Voice to editable draft and attachments as context.
3. Fixed turn snapshots and IDEA native side-by-side Diff.

The existing screenshots under `build/reports/` are test evidence and include fixture labels. Capture final Marketplace screenshots from an installed release build before submission.

## Upload checklist

- Build and verify all four supported runtime binaries.
- Confirm `pluginIcon.svg` is present under `META-INF` in the plugin JAR.
- Confirm the built `plugin.xml` contains the English-first bilingual description, 0.1.25 change notes, `since-build="241"`, and no `until-build` attribute.
- Install the release ZIP in IDEA 2024.1 and 2024.3 from disk.
- Capture final 1280×800 screenshots from the installed release build.
- Accept the JetBrains Marketplace Developer Agreement and declare trader or non-trader status.
- Create or select the Vendor profile and verify its public support email.
- Select AGPL-3.0 and provide the license, source, issue tracker, and privacy links above.
- Upload the ZIP to a hidden or custom channel first if another review round is needed.
