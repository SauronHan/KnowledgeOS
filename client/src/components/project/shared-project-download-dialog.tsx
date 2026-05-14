import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FolderOpen, Download, Loader2 } from "lucide-react"
import type { WikiProject } from "@/types/wiki"

export interface SharedProjectDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: {
    id: string
    name: string
    serverId: number
    version: number
    packageSize: number
    isReadonly: boolean
  }
  onDownloaded: (project: WikiProject) => void
}

export interface SharedProjectDownloadResult {
  project: WikiProject
  action: "download" | "manual"
}

export function SharedProjectDownloadDialog({
  open: isOpen,
  onOpenChange,
  project,
  onDownloaded,
}: SharedProjectDownloadDialogProps) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")

  function formatSize(bytes: number): string {
    if (bytes === 0) return "N/A"
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleDownload() {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const { downloadAndExtractSharedProject } = await import("@/commands/fs")
    const { getAuthToken, getServerUrl } = await import("@/lib/api-client")
    const { writeSharedMeta } = await import("@/lib/shared-project")
    const { saveLastProject } = await import("@/lib/project-store")
    const { ensureProjectId, upsertProjectInfo } = await import("@/lib/project-identity")

    setDownloading(true)
    setError("")
    try {
      const serverBase = getServerUrl().replace(/\/+$/, "")
      const url = `${serverBase}/api/v1/shared-projects/${project.serverId}/download`
      const token = getAuthToken()
      if (!token) throw new Error("Not authenticated")

      const defaultRoot = useWikiStore.getState().projectRoot
      if (!defaultRoot) throw new Error("Project root not configured")

      const result = await downloadAndExtractSharedProject(
        url, token, defaultRoot, project.name, project.id,
      )

      // Write shared-meta
      await writeSharedMeta(result.path, {
        project_uuid: project.id,
        version: project.version,
        downloaded_at: new Date().toISOString(),
        package_filename: "",
      })

      // Set up project identity
      const existingId = await ensureProjectId(result.path)
      await upsertProjectInfo(existingId, result.path, result.name)

      const wikiProject: WikiProject = {
        id: project.id,
        name: result.name,
        path: result.path,
        serverId: project.serverId,
        visibility: "shared",
        isReadonly: project.isReadonly,
        packageVersion: project.version,
      }
      await saveLastProject(wikiProject)

      onOpenChange(false)
      onDownloaded(wikiProject)
    } catch (err) {
      setError(String(err))
    } finally {
      setDownloading(false)
    }
  }

  async function handleManualSelect() {
    const { writeSharedMeta } = await import("@/lib/shared-project")
    const { openProject } = await import("@/commands/fs")
    const { saveLastProject } = await import("@/lib/project-store")

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select the project directory",
      })
      if (!selected) return

      const validated = await openProject(selected)
      const wikiProject: WikiProject = {
        id: project.id,
        name: validated.name,
        path: validated.path,
        serverId: project.serverId,
        visibility: "shared",
        isReadonly: project.isReadonly,
        packageVersion: project.version,
      }

      // Write shared-meta
      await writeSharedMeta(wikiProject.path, {
        project_uuid: project.id,
        version: project.version,
        downloaded_at: new Date().toISOString(),
        package_filename: "",
      })

      await saveLastProject(wikiProject)
      onOpenChange(false)
      onDownloaded(wikiProject)
    } catch (err) {
      setError(String(err))
    }
  }

  function handleCancel() {
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Download Shared Project</DialogTitle>
          <DialogDescription>
            This shared project needs to be downloaded to your local machine before you can open it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Project</span>
              <span className="font-medium">{project.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-medium">v{project.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Package Size</span>
              <span className="font-medium">{formatSize(project.packageSize)}</span>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>
          )}

          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button onClick={handleDownload} disabled={downloading} className="w-full">
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {downloading ? "Downloading..." : "Download & Extract to Default Path"}
            </Button>
            <Button variant="outline" onClick={handleManualSelect} disabled={downloading} className="w-full">
              <FolderOpen className="mr-2 h-4 w-4" />
              I Already Downloaded — Select Directory
            </Button>
            <Button variant="ghost" onClick={handleCancel} disabled={downloading}>
              Cancel
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
