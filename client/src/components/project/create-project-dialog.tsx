import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FolderOpen, ArrowLeft, ArrowRight } from "lucide-react"
import { createProject, writeFile, createDirectory } from "@/commands/fs"
import { getTemplate } from "@/lib/templates"
import type { WikiProject } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { OUTPUT_LANGUAGE_OPTIONS } from "@/lib/output-language-options"
import { useWikiStore, type OutputLanguage } from "@/stores/wiki-store"
import { saveOutputLanguage } from "@/lib/project-store"
import { ShareTenantPicker } from "./share-tenant-picker"

export interface CreateProjectResult {
  project: WikiProject
  /** null = ALL tenants, number[] = specific tenants, undefined = private project */
  tenantIds?: number[] | null
}

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (result: CreateProjectResult) => void
  shared?: boolean
}

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated, shared = false }: CreateProjectDialogProps) {
  const [step, setStep] = useState(0)  // 0 = tenant picker (shared only), 1 = project form
  const [tenantIds, setTenantIds] = useState<number[] | null>(null)
  const [name, setName] = useState("")
  const projectRoot = useWikiStore((s) => s.projectRoot)
  const [path, setPath] = useState(projectRoot)
  const [language, setLanguage] = useState<string>("")
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const setOutputLanguage = useWikiStore((s) => s.setOutputLanguage)

  function resetForm() {
    setName("")
    setPath(projectRoot)
    setLanguage("")
    setError("")
    setStep(0)
    setTenantIds(null)
  }

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Parent Directory",
    })
    if (selected) setPath(selected)
  }

  async function handleCreate() {
    if (!name.trim() || !path.trim()) {
      setError("Name and path are required")
      return
    }
    if (!language) {
      setError("Please pick an AI output language")
      return
    }
    setCreating(true)
    setError("")
    try {
      const project = await createProject(name.trim(), path.trim(), shared ? tenantIds : undefined)
      const pp = normalizePath(project.path)

      const template = getTemplate("research")
      await writeFile(`${pp}/schema.md`, template.schema)
      await writeFile(`${pp}/purpose.md`, template.purpose)
      for (const dir of template.extraDirs) {
        await createDirectory(`${pp}/${dir}`)
      }

      const lang = language as OutputLanguage
      setOutputLanguage(lang)
      await saveOutputLanguage(lang)

      onCreated({
        project: { ...project, visibility: shared ? "shared" : undefined },
        tenantIds: shared ? tenantIds : undefined,
      })
      onOpenChange(false)
      resetForm()
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  function handleNext() {
    if (shared && tenantIds === undefined) {
      setError("Please select target tenants")
      return
    }
    setError("")
    setStep(1)
  }

  function handleCancel() {
    onOpenChange(false)
    resetForm()
  }

  const showTenantStep = shared && step === 0

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{shared ? "Create Shared Project" : "Create Private Project"}</DialogTitle>
          {showTenantStep && (
            <p className="text-sm text-muted-foreground">Step 1 of 2: Select visible tenants</p>
          )}
        </DialogHeader>

        {showTenantStep ? (
          <div className="flex flex-col gap-4 py-4">
            <ShareTenantPicker selectedIds={tenantIds!} onChange={setTenantIds} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button onClick={handleNext}>
                Next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 py-4">
              {shared && (
                <button
                  onClick={() => setStep(0)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground -mb-2"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to tenant selection
                </button>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Project Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-research-wiki" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="language">
                  AI Output Language <span className="text-destructive">*</span>
                </Label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>Pick a language…</option>
                  {OUTPUT_LANGUAGE_OPTIONS.filter((l) => l.value !== "auto").map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  All AI-generated content (wiki pages, chat replies, research
                  output) will use this language. You can change it later in
                  Settings → Output.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="path">Parent Directory</Label>
                <div className="flex gap-2">
                  <Input id="path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/projects" className="flex-1" />
                  <Button variant="outline" size="icon" onClick={handleBrowse} type="button">
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
