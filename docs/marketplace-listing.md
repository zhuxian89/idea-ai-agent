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
| Tags | AI, Code tools, Productivity |
| Supported IDE builds | 241 and later (IntelliJ IDEA 2024.1+) |
| Release channel | Default |

Use the public email attached to the JetBrains Vendor profile as the support email. The repository does not define a public support mailbox.

## Short summary

Use locally installed coding agents inside IntelliJ IDEA.

## Description

The canonical Marketplace description is in `src/main/resources/META-INF/plugin.xml`. JetBrains reads it from the uploaded plugin ZIP. Do not paste a second, divergent description into the Marketplace page.

## Version 0.1.19 change notes

The canonical change notes are also in `src/main/resources/META-INF/plugin.xml` and are included in the built ZIP.

## Reviewer notes

Local AI Agent starts a bundled local service on a random `127.0.0.1` port. The service is protected by an ephemeral token and exits with its IDEA project. Conversation data is stored locally in the IDEA configuration directory.

The plugin invokes supported Agent CLIs installed on the user's machine. Those CLIs may connect to model providers according to their existing configuration and authentication. The plugin itself has no vendor-operated backend, telemetry, advertising, or paid feature.

Release packages contain an operating-system and CPU-specific Go executable. The initial release supports Windows x64 and macOS arm64. The Marketplace artifact must contain both executables before it is offered to both platforms; IDEA 2024.x does not support Marketplace native variants.

This is an independent open-source project. It is not affiliated with JetBrains, OpenAI, or Anthropic.

## Media

Use screenshots with the default IDEA theme, no personal data, and a consistent 1280×800 canvas. Recommended feature order:

1. Conversation with streaming reply and tool activity.
2. Agent, model, reasoning effort, and execution permission controls.
3. Conversation history and Agent configuration.

The existing screenshots under `build/reports/` are test evidence and include fixture labels. Capture final Marketplace screenshots from an installed release build before submission.

## Upload checklist

- Build and verify both supported runtime binaries.
- Confirm `pluginIcon.svg` is present under `META-INF` in the plugin JAR.
- Confirm the built `plugin.xml` contains the English description, 0.1.19 change notes, `since-build="241"`, and no `until-build` attribute.
- Install the release ZIP in IDEA 2024.1 and 2024.3 from disk.
- Capture final 1280×800 screenshots from the installed release build.
- Accept the JetBrains Marketplace Developer Agreement and declare trader or non-trader status.
- Create or select the Vendor profile and verify its public support email.
- Select AGPL-3.0 and provide the license, source, issue tracker, and privacy links above.
- Upload the ZIP to a hidden or custom channel first if another review round is needed.
