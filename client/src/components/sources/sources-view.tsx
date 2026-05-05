import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, RefreshCw, FileText, Eye, Trash2, Folder, ChevronRight, ChevronDown, BookOpen, Database } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import { kosFetch, kosApiRequest, API_BASE_URL, getAuthToken } from "@/lib/api-client"

export function SourcesView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null)
  const [pendingReprocessPath, setPendingReprocessPath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const serverConfig = useWikiStore((s) => s.serverConfig)
  const [mode, setMode] = useState<"sources" | "wiki">("sources")
  const [wikiNodes, setWikiNodes] = useState<any[]>([])

  useEffect(() => {
    if (!pendingDeletePath && !pendingReprocessPath) return
    const t = setTimeout(() => {
      setPendingDeletePath(null)
      setPendingReprocessPath(null)
    }, 5000)
    return () => clearTimeout(t)
  }, [pendingDeletePath, pendingReprocessPath])

  const loadSources = useCallback(async () => {
    if (!project) return
    
    try {
      const data = await kosApiRequest("/documents")
      if (data.status === "success" && Array.isArray(data.data)) {
        const docs = data.data.map((doc: any) => ({
          name: doc.filename,
          path: `document_${doc.id}`,
          is_dir: false,
          serverStatus: doc.status
        }))
        setSources(docs)
      } else {
        setSources([])
      }
    } catch (err) {
      console.error("[Lyrebird KOS] Failed to load documents from server:", err)
      setSources([])
    }
  }, [project])

  const loadWiki = useCallback(async () => {
    if (!project || !project.serverId) return
    try {
      const data = await kosApiRequest(`/concepts?project_id=${project.serverId}`)
      if (data.status === "success" && data.data) {
        // Map backend ConceptNode to UI expectations (label, type)
        const mapped = data.data.map((n: any) => ({
          ...n,
          label: n.name,
          type: n.entity_type
        }))
        setWikiNodes(mapped)
      }
    } catch (err) {
      console.error("[Lyrebird KOS] Failed to load wiki nodes:", err)
    }
  }, [project])

  useEffect(() => {
    if (mode === "sources") {
      loadSources()
    } else {
      loadWiki()
    }
  }, [loadSources, loadWiki, mode])

  useEffect(() => {
    const hasPending = sources.some(
      (s) => s.serverStatus === "pending" || s.serverStatus === "processing"
    )
    if (hasPending) {
      const interval = setInterval(() => {
        loadSources()
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [sources, loadSources])

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return

    setImporting(true)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const formData = new FormData()
      formData.append("file", file)
      
      try {
        const data = await kosApiRequest("/ingest/", {
          method: "POST",
          body: formData,
        })
        console.log(`[Lyrebird KOS] 成功投递文档至中心大脑，任务 ID: ${data.document_id}`)
      } catch (err) {
        console.error(`[Lyrebird KOS] 文档上传失败:`, err)
        window.alert(`上传 ${file.name} 失败: ${err}`)
      }
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    setImporting(false)
    await loadSources()
  }

  async function handleImportFolder() {
    window.alert("Web 模式下暂不支持直接选择系统文件夹。请选中文件夹内的多个文件上传。")
  }

  async function handleOpenSource(node: FileNode) {
    if (!project) return
    const docId = node.path.replace('document_', '')
    if (!docId) return
    try {
      const data = await kosApiRequest(`/documents/${docId}/content`)
      setFileContent(data.data.content)
      setSelectedFile(node.path)
    } catch (err) {
      console.error("Failed to read source:", err)
    }
  }

  async function handleReprocess(node: FileNode) {
    if (!project) return
    const docId = node.path.replace('document_', '')
    if (!docId) return
    try {
      await kosApiRequest(`/ingest/${docId}/reprocess`, {
        method: 'POST'
      })
      await loadSources()
    } catch (err) {
      console.error("Failed to reprocess:", err)
      window.alert(`Failed to reprocess document: ${err}`)
    }
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const docId = node.path.replace('document_', '')
    if (!docId) return
    try {
      await kosApiRequest(`/documents/${docId}`, {
        method: 'DELETE'
      })
      
      await loadSources()
      useWikiStore.getState().bumpDataVersion()
      if (selectedFile === node.path) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete source:", err)
      window.alert(`Failed to delete: ${err}`)
    }
  }

  async function handleDeleteFolder() {
    window.alert("Web 模式下暂不支持批量删除文件夹，请手动删除该文件夹下的文件。")
  }

  async function handleViewRaw(node: FileNode) {
    if (!project) return
    const docId = node.path.replace('document_', '')
    if (!docId) return
    const token = getAuthToken()
    if (!token) {
      window.alert("未登录，无法查看")
      return
    }

    const viewUrl = `${API_BASE_URL}/documents/${docId}/download?token=${encodeURIComponent(token)}`
    try {
      await openUrl(viewUrl)
    } catch (err) {
      console.error("Failed to open view URL:", err)
      // Fallback for non-tauri environments (like web dev)
      window.open(viewUrl, '_blank')
    }
  }

  async function handleOpenWikiNode(node: any) {
    const conceptId = node.id
    if (!conceptId) return
    
    try {
      const data = await kosApiRequest(`/concepts/${conceptId}`)
      if (data?.data?.rich_content) {
        setFileContent(data.data.rich_content)
        // Use concept:// prefix so preview-panel won't try to re-read from local disk
        setSelectedFile(`concept://${node.id || node.label}`)
      }
    } catch (err) {
      console.error("Failed to load concept content:", err)
      // Fallback: use description from graph data
      const desc = node.description || "_No detailed description available._"
      const content = `# ${node.label || node.name}\n\n**Type**: ${node.type}\n\n${desc}`
      setFileContent(content)
      setSelectedFile(`concept://${node.id || node.label}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex p-0.5 bg-muted rounded-lg">
          <button
            onClick={() => setMode("sources")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              mode === "sources" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Sources
          </button>
          <button
            onClick={() => setMode("wiki")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              mode === "wiki" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Wiki
          </button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={mode === "sources" ? loadSources : loadWiki} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {mode === "sources" && (
            <>
              <Button size="sm" className="h-8 text-xs px-2" onClick={handleImportClick} disabled={importing}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {importing ? "..." : t("sources.import")}
              </Button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {mode === "sources" ? (
          sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <p>{t("sources.noSources")}</p>
              <Button variant="outline" size="sm" onClick={handleImportClick}>
                <Plus className="mr-1 h-4 w-4" />
                {t("sources.importFiles")}
              </Button>
            </div>
          ) : (
            <div className="p-2">
              <SourceTree
                nodes={sources}
                onOpen={handleOpenSource}
                onViewRaw={handleViewRaw}
                onDelete={handleDelete}
                onDeleteFolder={handleDeleteFolder}
                onReprocess={handleReprocess}
                pendingDeletePath={pendingDeletePath}
                setPendingDeletePath={setPendingDeletePath}
                pendingReprocessPath={pendingReprocessPath}
                setPendingReprocessPath={setPendingReprocessPath}
                depth={0}
              />
            </div>
          )
        ) : (
          <div className="p-2 flex flex-col gap-0.5">
            {wikiNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <p>No knowledge concepts yet.</p>
                <p className="text-xs mt-1">Ingest sources to build your wiki.</p>
              </div>
            ) : (
              wikiNodes.sort((a, b) => a.label.localeCompare(b.label)).map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleOpenWikiNode(node)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm rounded-md transition-colors hover:bg-accent group ${
                    selectedFile === `${node.path}.md` ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 ${node.type === 'concept' ? 'bg-purple-400' : 'bg-blue-400'}`} />
                  <span className="truncate flex-1">{node.label}</span>
                  <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                </button>
              ))
            )}
          </div>
        )}
      </ScrollArea>

      <input 
        type="file" 
        multiple 
        ref={fileInputRef} 
        style={{ display: "none" }} 
        onChange={handleFileSelected} 
      />

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {t("sources.sourceCount", { count: countFiles(sources) })}
      </div>
    </div>
  )
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      count += countFiles(node.children)
    } else if (!node.is_dir) {
      count++
    }
  }
  return count
}

function SourceTree({
  nodes,
  onOpen,
  onViewRaw,
  onDelete,
  onDeleteFolder,
  pendingDeletePath,
  setPendingDeletePath,
  pendingReprocessPath,
  setPendingReprocessPath,
  depth,
  onReprocess,
}: {
  nodes: FileNode[]
  onOpen: (node: FileNode) => void
  onViewRaw: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  onDeleteFolder: (node: FileNode) => void
  onReprocess: (node: FileNode) => void
  pendingDeletePath: string | null
  setPendingDeletePath: (path: string | null) => void
  pendingReprocessPath: string | null
  setPendingReprocessPath: (path: string | null) => void
  depth: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  const handleDeleteClick = (node: FileNode) => {
    if (pendingDeletePath === node.path) {
      setPendingDeletePath(null)
      if (node.is_dir) {
        onDeleteFolder(node)
      } else {
        onDelete(node)
      }
    } else {
      setPendingDeletePath(node.path)
      setPendingReprocessPath(null)
    }
  }

  const handleReprocessClick = (node: FileNode) => {
    if (pendingReprocessPath === node.path) {
      setPendingReprocessPath(null)
      onReprocess(node)
    } else {
      setPendingReprocessPath(node.path)
      setPendingDeletePath(null)
    }
  }

  const sorted = [...nodes].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {sorted.map((node) => {
        const isPendingDelete = pendingDeletePath === node.path
        if (node.is_dir && node.children) {
          const isCollapsed = collapsed[node.path] ?? false
          return (
            <div key={node.path}>
              <div
                className="group flex w-full items-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
              >
                <button
                  onClick={() => toggle(node.path)}
                  className="flex flex-1 items-center gap-1.5 px-1 py-1 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="truncate font-medium">{node.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                    {countFiles(node.children)}
                  </span>
                </button>
                <DeleteButton
                  isPending={isPendingDelete}
                  onClick={() => handleDeleteClick(node)}
                  hint={isPendingDelete ? "Click again to confirm" : "Delete folder"}
                />
              </div>
              {!isCollapsed && (
                <SourceTree
                  nodes={node.children}
                  onOpen={onOpen}
                  onViewRaw={onViewRaw}
                  onDelete={onDelete}
                  onDeleteFolder={onDeleteFolder}
                  onReprocess={onReprocess}
                  pendingDeletePath={pendingDeletePath}
                  setPendingDeletePath={setPendingDeletePath}
                  pendingReprocessPath={pendingReprocessPath}
                  setPendingReprocessPath={setPendingReprocessPath}
                  depth={depth + 1}
                />
              )}
            </div>
          )
        }

        return (
          <div
            key={node.path}
            className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
          >
            <button
              onClick={() => onOpen(node)}
              className="flex flex-1 items-center gap-2 truncate px-2 py-1 text-left"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{node.name}</span>
              {node.serverStatus === 'pending' && <span className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-600 px-1 rounded-sm shrink-0">排队中</span>}
              {node.serverStatus === 'processing' && <span className="ml-1 text-[10px] bg-blue-500/20 text-blue-500 px-1 rounded-sm shrink-0">处理中</span>}
              {node.serverStatus === 'audit_required' && <span className="ml-1 text-[10px] bg-orange-500/20 text-orange-600 px-1 rounded-sm shrink-0 font-medium">待审核</span>}
              {node.serverStatus === 'failed' && <span className="ml-1 text-[10px] bg-destructive/20 text-destructive px-1 rounded-sm shrink-0">失败</span>}
              {node.serverStatus === 'completed' && <span className="ml-1 text-[10px] bg-green-500/20 text-green-600 px-1 rounded-sm shrink-0">已完成</span>}
              {node.serverStatus === 'failed' && <span className="ml-1 text-[10px] bg-red-500/20 text-red-600 px-1 rounded-sm shrink-0">失败</span>}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-blue-500"
              title="View Raw File"
              onClick={() => onViewRaw(node)}
            >
              <Eye className="h-4 w-4" />
            </Button>
            
            {node.serverStatus !== 'pending' && node.serverStatus !== 'processing' && (
              <ReprocessButton
                isPending={pendingReprocessPath === node.path}
                onClick={() => handleReprocessClick(node)}
              />
            )}
            
            <DeleteButton
              isPending={isPendingDelete}
              onClick={() => handleDeleteClick(node)}
              hint={isPendingDelete ? "Click again to confirm" : "Delete file"}
            />
          </div>
        )
      })}
    </>
  )
}

function ReprocessButton({
  isPending,
  onClick,
}: {
  isPending: boolean
  onClick: () => void
}) {
  if (isPending) {
    return (
      <Button
        variant="default"
        size="sm"
        className="h-7 shrink-0 px-2 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 animate-pulse"
        title="Click again to confirm reprocessing"
        onClick={onClick}
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        Ingest
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-blue-500"
      title="Reprocess Document"
      onClick={onClick}
    >
      <RefreshCw className="h-3.5 w-3.5" />
    </Button>
  )
}

function DeleteButton({
  isPending,
  onClick,
  hint,
}: {
  isPending: boolean
  onClick: () => void
  hint: string
}) {
  if (isPending) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className="h-7 shrink-0 px-2 text-[11px] font-semibold animate-pulse"
        title={hint}
        onClick={onClick}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Confirm
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      title={hint}
      onClick={onClick}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}
