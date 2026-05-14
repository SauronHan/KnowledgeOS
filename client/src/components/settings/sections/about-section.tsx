import { useTranslation } from "react-i18next"

export function AboutSection() {
  const { t } = useTranslation()

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t("settings.sections.about.version"), value: `v0.5.6`, mono: true },
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
          {t("settings.sections.about.body")}
        </p>
      </div>
    </div>
  )
}

