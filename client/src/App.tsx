import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject } from "@/commands/fs"
import { getRecentProjects, saveLastProject, loadLlmConfig, loadSearchApiConfig, loadEmbeddingConfig, loadMultimodalConfig, loadOutputLanguage, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadServerConfig, loadProjectRoot, loadChatSystemPrompt } from "@/lib/project-store"
import { loadReviewItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave } from "@/lib/auto-save"
import { startClipWatcher } from "@/lib/clip-watcher"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog, type CreateProjectResult } from "@/components/project/create-project-dialog"
import { SharedProjectDownloadDialog } from "@/components/project/shared-project-download-dialog"
import { LoginScreen } from "@/components/auth/login"
import { ServerConfigScreen } from "@/components/auth/server-config"
import { Button } from "@/components/ui/button"
import { FolderOpen } from "lucide-react"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const projectRoot = useWikiStore((s) => s.projectRoot)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createShared, setCreateShared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [serverConfigured, setServerConfigured] = useState(false)
  const [downloadDialogProject, setDownloadDialogProject] = useState<{
    id: string; name: string; serverId: number; version: number; packageSize: number; isReadonly: boolean
  } | null>(null)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    setupAutoSave()
    startClipWatcher()
  }, [])

  // Dev-only helper for visually testing the update-banner UX.
  // Open dev tools and run:
  //   __llmwiki_testUpdateBanner()
  // to inject a fake "available" result into the update store —
  // banner appears at the top + red dot lights up the gear icon.
  // Run again with arg `false` (or call setDismissed via the store)
  // to clear. Gated on `import.meta.env.DEV` so the helper never
  // ships in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(async () => {
      const storeMod = await import("@/stores/update-store")
      const { useUpdateStore } = storeMod
      // Expose the live store getter on window so you can inspect
      // state from devtools when debugging banner behavior.
      ;(window as unknown as { __llmwiki_updateStore?: typeof useUpdateStore }).__llmwiki_updateStore = useUpdateStore
      ;(window as unknown as { __llmwiki_testUpdateBanner?: (clear?: boolean) => void }).__llmwiki_testUpdateBanner = (clear = false) => {
        if (clear) {
          useUpdateStore.getState().setResult(
            { kind: "up-to-date", local: __APP_VERSION__, remote: __APP_VERSION__ },
            Date.now(),
          )
          useUpdateStore.getState().setDismissed(null)
          console.log("[test] update banner cleared")
          return
        }
        useUpdateStore.getState().setResult(
          {
            kind: "available",
            local: __APP_VERSION__,
            remote: "v999.0.0",
            release: {
              name: "v999.0.0 (test)",
              tag_name: "v999.0.0",
              body:
                "Test release for banner-UX verification.\n\n" +
                "- Bigger red dot on the Settings icon\n" +
                "- Top banner with one-click dismiss\n" +
                "- Once dismissed, won't reappear for this version",
              html_url: "https://github.com/nashsu/llm_wiki/releases",
              published_at: new Date().toISOString(),
            },
          },
          Date.now(),
        )
        useUpdateStore.getState().setDismissed(null)
        console.log(
          "[test] update banner injected. Run __llmwiki_testUpdateBanner(true) to clear.",
        )
      }
    })()
  }, [])

  // Background update check — hydrate persisted user preferences, then
  // hit GitHub at most once every UPDATE_CHECK_CACHE_MS. Runs 1.5 s
  // after mount so it doesn't contend with the heaviest startup work
  // (project load, file tree, vector store init) but still surfaces
  // a new release in time for the user to notice it during their
  // first interaction. Silent on failure; the UI in Settings → About
  // lets the user retry manually.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const { loadUpdateCheckState, saveUpdateCheckState } = await import(
          "@/lib/project-store"
        )
        const { useUpdateStore } = await import("@/stores/update-store")
        const { checkForUpdates, UPDATE_CHECK_CACHE_MS } = await import(
          "@/lib/update-check"
        )

        const persisted = await loadUpdateCheckState()
        if (persisted) useUpdateStore.getState().hydrate(persisted)

        const state = useUpdateStore.getState()
        if (!state.enabled) {
          console.log("[update-check] skipped: user disabled auto-check in settings")
          return
        }

        const now = Date.now()
        // Cache hit requires BOTH the timestamp AND the in-memory
        // result to be present. `lastCheckedAt` is persisted to
        // disk but `lastResult` deliberately is not — keeping the
        // GitHub payload out of the persisted store keeps disk
        // size + privacy footprint small. The downside: a fresh
        // cold start has `lastResult === null` even when
        // `lastCheckedAt` is recent, in which case we MUST refetch
        // — otherwise we'd skip the check AND have no result to
        // display, leaving the banner permanently stuck off.
        // (This was the user-reported bug: "kind=none, no banner".)
        const fresh =
          state.lastCheckedAt !== null &&
          state.lastResult !== null &&
          now - state.lastCheckedAt < UPDATE_CHECK_CACHE_MS
        if (fresh) {
          const ageMin = Math.round((now - (state.lastCheckedAt ?? 0)) / 60_000)
          console.log(
            `[update-check] skipped: cache hit (last check ${ageMin} min ago, ` +
              `cache window ${UPDATE_CHECK_CACHE_MS / 60_000} min). ` +
              `Last result: kind=${state.lastResult?.kind ?? "none"}`,
          )
          return
        }

        useUpdateStore.getState().setChecking(true)
        console.log(
          `[update-check] fetching GitHub releases (local=${__APP_VERSION__})`,
        )
        const result = await checkForUpdates({
          currentVersion: __APP_VERSION__,
          repo: "nashsu/llm_wiki",
        })
        if (cancelled) return
        useUpdateStore.getState().setResult(result, Date.now())
        if (result.kind === "available") {
          console.log(
            `[update-check] update available: local=${result.local} → remote=${result.remote}`,
          )
        } else if (result.kind === "up-to-date") {
          console.log(
            `[update-check] up to date: local=${result.local}, remote latest=${result.remote}`,
          )
        } else {
          console.log(`[update-check] error: ${result.message}`)
        }
        await saveUpdateCheckState({
          enabled: useUpdateStore.getState().enabled,
          lastCheckedAt: Date.now(),
          dismissedVersion: useUpdateStore.getState().dismissedVersion,
        })
      } catch {
        // Silent — Settings → About lets the user retry manually.
      }
    }, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        }
        const savedActivePreset = await loadActivePresetId()
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults — their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
          const { resolveConfig } = await import("@/components/settings/preset-resolver")
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            const { saveLlmConfig } = await import("@/lib/project-store")
            await saveLlmConfig(resolved)
          }
        }
        const savedSearchConfig = await loadSearchApiConfig()
        if (savedSearchConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchConfig)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedMultimodalConfig = await loadMultimodalConfig()
        if (savedMultimodalConfig) {
          useWikiStore.getState().setMultimodalConfig(savedMultimodalConfig)
        }
        const savedOutputLang = await loadOutputLanguage()
        if (savedOutputLang) {
          useWikiStore.getState().setOutputLanguage(savedOutputLang)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        const savedServer = await loadServerConfig()
        if (savedServer) {
          useWikiStore.getState().setServerConfig(savedServer)
        }
        const savedProjectRoot = await loadProjectRoot()
        if (savedProjectRoot) {
          useWikiStore.getState().setProjectRoot(savedProjectRoot)
        }
        const savedChatPrompt = await loadChatSystemPrompt()
        if (savedChatPrompt) {
          useWikiStore.getState().setChatSystemPromptOverride(savedChatPrompt)
        }
        // Clear any stale auth from previous sessions — login is always
        // required on every startup.
        localStorage.removeItem("kos_auth_token")
        localStorage.removeItem("kos_current_user")
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()

    // Sync localStorage X-Project-Id BEFORE setProject, so SourcesView picks up correct ID
    if (proj.serverId) {
      (await import("@/lib/api-client")).setProjectServerId(proj.serverId)
    } else {
      (await import("@/lib/api-client")).setProjectServerId(null)
    }

    setProject(proj)
    setFileTree([])
    setSelectedFile(null)
    setActiveView("wiki")
    useWikiStore.getState().bumpDataVersion()
    await saveLastProject(proj)

    const isShared = proj.visibility === "shared"

    if (!isShared) {
      // 私有项目：恢复 ingest/dedup 队列 + clip server 通知
      import("@/lib/ingest-queue").then(({ restoreQueue }) => {
        restoreQueue(proj.id, proj.path).catch((err) =>
          console.error("Failed to restore ingest queue:", err)
        )
      })
      import("@/lib/dedup-queue").then(({ restoreQueue }) => {
        restoreQueue(proj.id, proj.path).catch((err) =>
          console.error("Failed to restore dedup queue:", err)
        )
      })
      fetch("http://127.0.0.1:19827/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: proj.path }),
      }).catch(() => {})
      getRecentProjects().then((recents) => {
        const projects = recents.map((p) => ({ name: p.name, path: p.path }))
        fetch("http://127.0.0.1:19827/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projects }),
        }).catch(() => {})
      }).catch(() => {})
    }

    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
    // Load persisted review items
    try {
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0) {
        useReviewStore.getState().setItems(savedReview)
      }
    } catch {
      // ignore, start fresh
    }
    // Load persisted chat history
    try {
      const savedChat = await loadChatHistory(proj.path)
      if (savedChat.conversations.length > 0) {
        useChatStore.getState().setConversations(savedChat.conversations)
        useChatStore.getState().setMessages(savedChat.messages)
        // Set most recent conversation as active
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
    } catch {
      // ignore, start fresh
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      // 共享项目：检查是否有本地副本，进行版本比对
      if (proj.visibility === "shared" && proj.serverId) {
        const { readSharedMeta } = await import("@/lib/shared-project")
        const { kosApiRequest } = await import("@/lib/api-client")
        const { getRecentProjects } = await import("@/lib/project-store")

        // 查询本地 recentProjects 中是否有该共享项目的本地路径
        const recents = await getRecentProjects()
        const localEntry = recents.find(
          (r) => r.id === proj.id && !r.path.startsWith("server_")
        )

        // 从 server 获取最新版本
        let serverVersion = 0
        let packageSize = 0
        try {
          const verData = await kosApiRequest(`/shared-projects/${proj.serverId}/version`)
          if (verData?.status === "success" && verData.data) {
            serverVersion = verData.data.version || 0
            packageSize = verData.data.size || 0
          }
        } catch (err) {
          console.error("Failed to get shared project version:", err)
          window.alert("Failed to check project version. Please try again.")
          return
        }

        if (serverVersion === 0) {
          window.alert("This shared project has not been published yet.")
          return
        }

        // 如果有本地副本，检查版本
        if (localEntry) {
          let localVersion = 0
          try {
            const meta = await readSharedMeta(localEntry.path)
            localVersion = meta?.version || 0
          } catch {}

          if (localVersion >= serverVersion) {
            // 版本一致或更新，直接打开本地项目（跳过 syncProjectToServer 避免 UUID 冲突）
            const { invoke } = await import("@tauri-apps/api/core")
            const raw = await invoke<{ name: string; path: string }>("open_project", { path: localEntry.path })
            await handleProjectOpened({
              id: proj.id,
              name: raw.name,
              path: raw.path,
              serverId: proj.serverId,
              visibility: "shared",
              isReadonly: proj.isReadonly,
              packageVersion: serverVersion,
            })
            return
          }

          // 本地版本更低，需要更新
          const shouldUpdate = window.confirm(
            `Shared project "${proj.name}" has been updated to v${serverVersion} (you have v${localVersion}).\n\nClick OK to download the latest version.`
          )
          if (!shouldUpdate) {
            // 照常用旧版本打开（跳过 syncProjectToServer）
            const { invoke } = await import("@tauri-apps/api/core")
            const raw = await invoke<{ name: string; path: string }>("open_project", { path: localEntry.path })
            await handleProjectOpened({
              id: proj.id,
              name: raw.name,
              path: raw.path,
              serverId: proj.serverId,
              visibility: "shared",
              isReadonly: proj.isReadonly,
              packageVersion: localVersion,
            })
            return
          }
        }

        // 显示下载对话框
        setDownloadDialogProject({
          id: proj.id,
          name: proj.name,
          serverId: proj.serverId,
          version: serverVersion,
          packageSize,
          isReadonly: proj.isReadonly || false,
        })
        return
      }

      // 私有项目：直接打开
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  function handleDialogCreated(result: CreateProjectResult) {
    handleProjectOpened(result.project)
  }

  async function handleDownloadDialogClosed(proj: WikiProject) {
    setDownloadDialogProject(null)
    await handleProjectOpened(proj)
  }

  async function handleSwitchProject() {
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  function handleLogout() {
    handleSwitchProject()
    setAuthToken(null)
    setCurrentUser(null)
    setServerConfigured(false)
    localStorage.removeItem("kos_auth_token")
    localStorage.removeItem("kos_current_user")
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!serverConfigured) {
    return (
      <ServerConfigScreen
        onContinue={() => setServerConfigured(true)}
      />
    )
  }

  if (!authToken || !currentUser) {
    return (
      <LoginScreen
        onLogin={(token, user) => {
          setAuthToken(token)
          setCurrentUser(user)
          localStorage.setItem("kos_auth_token", token)
          localStorage.setItem("kos_current_user", JSON.stringify(user))
        }}
        onBack={() => setServerConfigured(false)}
      />
    )
  }

  if (!project) {
    const showProjectRootPrompt = !projectRoot

    return (
      <>
        {showProjectRootPrompt && (
          <ProjectRootSetup
            onDone={(rootPath) => {
              useWikiStore.getState().setProjectRoot(rootPath)
              import("@/lib/project-store").then(({ saveProjectRoot }) => saveProjectRoot(rootPath))
            }}
          />
        )}
        {!showProjectRootPrompt && (
          <>
            <WelcomeScreen
              onCreateSharedProject={() => { setCreateShared(true); setShowCreateDialog(true) }}
              onCreatePrivateProject={() => { setCreateShared(false); setShowCreateDialog(true) }}
              onSelectProject={handleSelectRecent}
              onLogout={handleLogout}
              currentUser={currentUser}
            />
            <CreateProjectDialog
              open={showCreateDialog}
              onOpenChange={setShowCreateDialog}
              onCreated={handleDialogCreated}
              shared={createShared}
            />
            {downloadDialogProject && (
              <SharedProjectDownloadDialog
                open={true}
                onOpenChange={(open) => { if (!open) setDownloadDialogProject(null) }}
                project={downloadDialogProject}
                onDownloaded={(proj) => handleDownloadDialogClosed(proj)}
              />
            )}
          </>
        )}
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} onLogout={handleLogout} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleDialogCreated}
        shared={createShared}
      />
    </>
  )
}

function ProjectRootSetup({ onDone }: { onDone: (rootPath: string) => void }) {
  const [path, setPath] = useState("")
  const [error, setError] = useState("")

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Default Project Directory",
    })
    if (selected) setPath(selected)
  }

  function handleConfirm() {
    const trimmed = path.trim()
    if (!trimmed) {
      setError("Please select a directory")
      return
    }
    onDone(trimmed)
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Welcome to Lyrebird KOS</h1>
          <p className="mt-2 text-sm text-slate-500">
            First, tell us where to store your projects. New projects will be created here by default.
            You can change this later in Settings → Network.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Default Project Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/Documents/Lyrebird"
                className="block flex-1 rounded-md border border-slate-300 py-2 px-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Button variant="outline" size="icon" onClick={handleBrowse} type="button">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleConfirm} className="w-full">
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

export default App
