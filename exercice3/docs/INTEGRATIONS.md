# Integrations and API keys

Everything in this report works locally. No external service is called. Integrations that would need a key or a server are **disabled and labelled** in the visual: Settings › Integrations.

## Current state

| Integration | Status | Notes |
|---|---|---|
| AI assistant | **Rule-based, local (active)** | `RuleBasedAssistant` in `src/modules/intel.ts`. It answers from computed metrics and cites the tables and period it used. |
| External LLM (OpenAI, Anthropic and others) | Disabled | The key field shows the fake placeholder `sk-demo-0000-PLACEHOLDER-NOT-A-REAL-KEY` and is read-only. |
| Email / Teams notifications | Disabled | Would need Power Automate or a backend |
| Write-back to the source | Not supported | Custom visuals cannot write to a data source without a backend |
| Map tiles | Not used | The schematic tile map avoids external calls |

## Why no key lives in the visual

- A custom visual's code and its saved properties are inside the `.pbix`. Anyone with the file can read them. A real key stored there would leak.
- The visual declares no `WebAccess` privilege, so it cannot call any URL. Power BI blocks network access from visuals that do not declare it.

## How to connect a real model later

When you have the real keys:

1. **Deploy a backend proxy.** For example an Azure Function. It holds the API key in its own secret store, such as Key Vault or app settings, never in the report. It exposes one endpoint, such as `POST /ask`, that takes `{question, context}` and returns `{text, cites}`.
2. **Allow the proxy in the visual.** Add the WebAccess privilege for that URL only, in `capabilities.json`:
   ```json
   { "name": "WebAccess", "essential": false, "parameters": ["https://<your-proxy>.azurewebsites.net"] }
   ```
3. **Write an adapter.** Implement `AssistantAdapter` (`src/modules/intel.ts`) as `ProxyAssistant`. It sends the question plus aggregated metrics (no raw rows, no salaries) to the proxy, and falls back to `RuleBasedAssistant` on error.
4. **Enable it.** Enable the provider in Settings › Integrations, then rebuild with `tools/build-visual.ps1`.
5. **Approve it in Power BI.** Your Power BI admin must allow custom visuals with web access in the tenant. Certified visuals cannot use WebAccess to arbitrary hosts.

Never paste a real key into `capabilities.json`, the visual's settings, the CSVs or this repository.
