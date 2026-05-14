import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle } from "lucide-react"
import { validateProxyUrl } from "@/lib/proxy-config"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function NetworkSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  // Live URL validation — only flag the user when they've actually
  // typed something. Empty + enabled is "form not yet finished",
  // not a hard error.
  const trimmed = draft.proxyUrl.trim()
  const validation = trimmed === "" ? null : validateProxyUrl(trimmed)
  const showError = draft.proxyEnabled && validation && !validation.ok

  return (
    <div className="space-y-6">
      {/* 核心：Lyrebird KOS Server 配置 */}
      <div className="space-y-3 pb-4 border-b">
        <div>
          <h2 className="text-xl font-semibold">Lyrebird KOS Server</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            配置企业后端的 API 网关地址。客户端的所有文档解析、知识查询与大模型对话将通过此地址进行。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="server-url">Server API URL</Label>
          <Input
            id="server-url"
            value={draft.serverUrl}
            onChange={(e) => setDraft("serverUrl", e.target.value)}
            placeholder="http://127.0.0.1:8080"
          />
        </div>
      </div>

      {/* 默认项目路径 */}
      <div className="space-y-3 pb-4 border-b">
        <div>
          <h2 className="text-xl font-semibold">Default Project Directory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            新建项目将默认在此目录下创建。共享项目解压后也会放置在此目录。可在创建项目时临时覆盖。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-root">Project Root Path</Label>
          <Input
            id="project-root"
            value={draft.projectRoot}
            onChange={(e) => setDraft("projectRoot", e.target.value)}
            placeholder="/Users/you/Documents/Lyrebird"
          />
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.network.title", { defaultValue: "Network" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.network.description", {
            defaultValue:
              "Route all outbound HTTP requests (LLM, embedding, search, update check) through a proxy. Changes apply on Save — no restart needed.",
          })}
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.proxyEnabled}
          onChange={(e) => setDraft("proxyEnabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          {t("settings.sections.network.enable", {
            defaultValue: "Enable proxy",
          })}
        </span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="proxy-url">
          {t("settings.sections.network.url", { defaultValue: "Proxy URL" })}
        </Label>
        <Input
          id="proxy-url"
          value={draft.proxyUrl}
          onChange={(e) => setDraft("proxyUrl", e.target.value)}
          placeholder="http://127.0.0.1:7890"
          disabled={!draft.proxyEnabled}
          className={showError ? "border-destructive" : ""}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.network.urlHelp", {
            defaultValue:
              "Full URL with scheme. Supported: http://, https://. (SOCKS5 not supported in this version.)",
          })}
        </p>
        {showError && validation && !validation.ok && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {validation.error}
          </p>
        )}
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.proxyBypassLocal}
          onChange={(e) => setDraft("proxyBypassLocal", e.target.checked)}
          disabled={!draft.proxyEnabled}
          className="mt-0.5 h-4 w-4"
        />
        <div className="space-y-1">
          <span className="text-sm">
            {t("settings.sections.network.bypassLocal", {
              defaultValue: "Bypass proxy for local addresses (recommended)",
            })}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.bypassLocalHelp", {
              defaultValue:
                "Requests to localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and *.local don't go through the proxy. Keep this on if you use Ollama / LM Studio / other local or LAN-deployed LLMs.",
            })}
          </p>
        </div>
      </label>

    </div>
  )
}
