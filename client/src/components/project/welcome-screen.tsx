import { useEffect, useState } from "react"
import { Plus, Clock, X, Lock, Building2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import { kosApiRequest } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"

interface WelcomeScreenProps {
  onCreateSharedProject: () => void
  onCreatePrivateProject: () => void
  onSelectProject: (project: WikiProject) => void
  onLogout: () => void
  currentUser: any | null
}

export function WelcomeScreen({
  onCreateSharedProject,
  onCreatePrivateProject,
  onSelectProject,
  onLogout,
  currentUser,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])
  const [serverProjects, setServerProjects] = useState<WikiProject[]>([])
  const isSystem = currentUser?.role === "system"

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})

    async function loadServerProjects() {
      try {
        const data = await kosApiRequest("/projects")
        if (data.status === "success" && Array.isArray(data.data)) {
          const mapped = data.data.map((p: any) => ({
            id: p.uuid,
            name: p.name,
            path: `server_${p.uuid}`,
            serverId: p.id,
            visibility: p.visibility,
            isReadonly: p.is_readonly,
            packageVersion: p.package_version || 0,
            packageFilename: p.package_filename,
          }))
          setServerProjects(mapped)
        }
      } catch (err) {
        console.error("Failed to load projects from server:", err)
      }
    }
    loadServerProjects()
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    const updated = await getRecentProjects()
    setRecentProjects(updated)
  }

  const localPathMap = new Map<string, string>()
  recentProjects.forEach(r => {
    if (!r.path.startsWith("server_")) {
      localPathMap.set(r.id, r.path)
    }
  })

  const displayedProjects = serverProjects.map(sp => {
    const localPath = localPathMap.get(sp.id)
    if (localPath) {
      return { ...sp, path: localPath }
    }
    return sp
  })

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 px-4 w-full max-w-2xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold">{t("app.title")}</h1>
          <p className="mt-2 text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={onCreateSharedProject} disabled={!isSystem}>
            <Building2 className="mr-2 h-4 w-4" />
            {t("welcome.newSharedProject", "Create Shared Project")}
          </Button>
          <Button variant="outline" onClick={onCreatePrivateProject}>
            <Plus className="mr-2 h-4 w-4" />
            {t("welcome.newPrivateProject", "Create Private Project")}
          </Button>
        </div>

        {!isSystem && (
          <p className="text-xs text-muted-foreground -mt-6">
            Only system administrators can create shared projects
          </p>
        )}

        {displayedProjects.length > 0 && (
          <div className="w-full">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("welcome.recentProjects")}
            </div>
            <div className="rounded-lg border bg-card">
              {displayedProjects.map((proj) => {
                const isShared = proj.visibility === "shared"
                const isNotPublished = isShared && proj.packageVersion === 0 && !proj.path.startsWith("server_")
                const isServerEntry = proj.path.startsWith("server_")

                return (
                <button
                  key={proj.id || proj.path}
                  onClick={() => {
                    if (isNotPublished) return
                    onSelectProject(proj)
                  }}
                  disabled={isNotPublished}
                  className={`group flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-b-0 ${
                    isNotPublished ? "opacity-50 cursor-not-allowed" : "hover:bg-accent"
                  }`}
                >
                  <div className="min-w-0 flex-1 flex items-center gap-3">
                    {isShared ? (
                      <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{proj.name}</span>
                        {isShared && isNotPublished && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal text-amber-600 border-amber-300">
                            Not Published
                          </Badge>
                        )}
                        {isShared && !isNotPublished && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                            {proj.isReadonly ? "Shared (Read-only)" : "Shared"}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {isServerEntry ? "Cloud Project" : proj.path}
                      </div>
                    </div>
                  </div>
                  {!isServerEntry && !isShared && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRemoveRecent(e, proj.path)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRemoveRecent(e as unknown as React.MouseEvent, proj.path)
                      }}
                      className="ml-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="pt-4">
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground hover:text-foreground">
            <LogOut className="mr-2 h-4 w-4" />
            {t("auth.logout", "Logout")}
          </Button>
        </div>
      </div>
    </div>
  )
}
