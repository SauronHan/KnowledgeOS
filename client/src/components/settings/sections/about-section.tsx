import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { openUrl } from "@tauri-apps/plugin-opener"
import { clipServerStatus } from "@/commands/fs"

export function AboutSection() {
  const { t } = useTranslation()

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t("settings.sections.about.version"), value: `v0.5.3`, mono: true },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.about.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.about.description")}
        </p>
      </div>

      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className={`text-sm ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-4 text-sm">
        <div className="font-medium">Lyrebird-KOS</div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Lyrebird-KOS 是下一代企业级知识图谱管理平台。系统采用先进的 SaaS 化 C/S 架构，通过 Tenant-User-Project 三级隔离机制确保数据主权与安全。平台集成了深度知识提取引擎，可自动将碎片化的 PDF、Markdown 等文档转化为高连通性的数据库驱动知识图谱。凭借“节点入库”技术，Lyrebird-KOS 消除了大模型解析中的幻觉与碎片化问题，为用户提供可追溯、可审计、且具备高度结构化的个人与企业智库体验。
        </p>
      </div>
    </div>
  )
}

