import { webSearch } from "./web-search"
import { streamChat } from "./llm-client"
import { writeFile, readFile } from "@/commands/fs"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { useResearchStore, type ResearchTask, type WebResult } from "@/stores/research-store"
import { normalizePath } from "@/lib/path-utils"
import { buildLanguageDirective } from "@/lib/output-language"
import { kosApiRequest } from "./api-client"

/**
 * Queue a deep research task.
 */
export function queueResearch(
  projectPath: string,
  topic: string,
  llmConfig: LlmConfig,
  searchQueries?: string[],
): string {
  const store = useResearchStore.getState()
  const taskId = crypto.randomUUID()

  store.addTask({
    id: taskId,
    topic,
    status: "queued",
    searchQueries: searchQueries || [],
    webResults: [],
    synthesis: "",
    createdAt: Date.now(),
  })

  // Start processing
  processQueue(projectPath, llmConfig)
  return taskId
}

async function processQueue(projectPath: string, llmConfig: LlmConfig) {
  const store = useResearchStore.getState()
  const activeCount = store.tasks.filter((t) => t.status === "searching" || t.status === "synthesizing").length
  if (activeCount >= 2) return

  const next = store.tasks.find((t) => t.status === "queued")
  if (!next) return

  processTask(projectPath, next.id, llmConfig).catch(console.error)
}

async function processTask(projectPath: string, taskId: string, llmConfig: LlmConfig) {
  const store = useResearchStore.getState()
  const pp = normalizePath(projectPath)

  try {
    store.updateTask(taskId, { status: "searching" })
    const task = store.tasks.find((t) => t.id === taskId)!

    // Step 1: Web Search
    const queries = task.searchQueries.length > 0 ? task.searchQueries : [task.topic]
    const allResults: WebResult[] = []

    for (const query of queries) {
      try {
        const results = await webSearch(query)
        allResults.push(...results)
        store.updateTask(taskId, { webResults: [...allResults] })
      } catch (err) {
        console.error(`Search failed for "${query}":`, err)
      }
    }

    if (allResults.length === 0) {
      throw new Error("No web results found")
    }

    // Step 2: Synthesis
    store.updateTask(taskId, { status: "synthesizing" })
    
    const context = allResults
      .map((r, i) => `[${i + 1}] ${r.title}\nSource: ${r.url}\nContent: ${r.content}`)
      .join("\n\n---\n\n")

    const langDirective = buildLanguageDirective(useWikiStore.getState().outputLanguage)
    const prompt = `
    ${langDirective}
    You are a Deep Researcher. Synthesize the following web search results into a comprehensive, structured report about "${task.topic}".
    
    Instructions:
    1. Use professional Markdown.
    2. Cite sources using [1], [2] notation.
    3. Include sections: Executive Summary, Detailed Analysis, Key Findings, and References.
    4. Be objective and highlight conflicting information if any.
    
    Search Results:
    ${context}
    `

    let accumulated = ""
    await streamChat(
      llmConfig,
      [
        { role: "system", content: "You are a helpful assistant that performs deep research." },
        { role: "user", content: prompt }
      ],
      {
        onToken: (chunk) => {
          accumulated += chunk
          store.updateTask(taskId, { synthesis: accumulated })
        },
        onDone: () => {},
        onError: (err) => {
          console.error("Stream error:", err)
          throw err
        }
      }
    )

    // Step 3: Synthesis complete - Auto-save to LOCAL draft
    store.updateTask(taskId, { status: "done", synthesis: accumulated })
    await saveResearchToLocal(pp, taskId)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.updateTask(taskId, {
      status: "error",
      error: message,
    })
  }

  onTaskFinished(pp, llmConfig)
}

/**
 * Saves research result to local disk (localFiles/{project}/research/).
 * This is a DRAFT and not yet in the Wiki/Sources.
 */
export async function saveResearchToLocal(
  projectPath: string,
  taskId: string
): Promise<string> {
  const store = useResearchStore.getState()
  const task = store.tasks.find((t) => t.id === taskId)
  if (!task || !task.synthesis) throw new Error("Task not found or no synthesis")

  const pp = normalizePath(projectPath)
  // Ensure the research directory exists - handled by writeFile parent creation
  
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 10)
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')
  const safeTopic = task.topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "-").slice(0, 30)
  const filename = `Research-${safeTopic}-${dateStr}-${timeStr}.md`
  const fullPath = `${pp}/research/${filename}`

  const cleanedSynthesis = task.synthesis
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .trimStart()

  const pageContent = [
    `# Research: ${task.topic}`,
    `> Generated: ${new Date().toLocaleString()}`,
    "",
    cleanedSynthesis,
    "",
    "## Sources",
    ...task.webResults.map((r, i) => `[${i + 1}] [${r.title}](${r.url}) - ${r.source}`),
  ].join("\n")

  try {
    await writeFile(fullPath, pageContent)
    store.updateTask(taskId, { savedPath: fullPath })
    return fullPath
  } catch (err) {
    console.error("Failed to save local research draft:", err)
    throw err
  }
}

/**
 * Publishes a local research draft to the remote Wiki (SaaS Backend).
 */
export async function publishResearchToWiki(
  taskId: string
): Promise<void> {
  const store = useResearchStore.getState()
  const task = store.tasks.find((t) => t.id === taskId)
  if (!task || !task.savedPath || !task.synthesis) throw new Error("Local draft not found")

  store.updateTask(taskId, { status: "saving" })

  try {
    // 1. Read current content from local disk (in case user edited it)
    const content = await readFile(task.savedPath)
    
    // 2. Upload to SaaS backend via /chat/save
    // This will trigger the backend ingestion pipeline
    const result = await kosApiRequest("/chat/save", {
      method: "POST",
      body: JSON.stringify({
        title: `Research: ${task.topic}`,
        content: content
      })
    })

    // 3. Update status - we keep the local path for editing, 
    // but the task is now effectively "Published"
    store.updateTask(taskId, { status: "done" })
    
    // Refresh global data version to show new doc in sources
    useWikiStore.getState().bumpDataVersion()
    
  } catch (err) {
    store.updateTask(taskId, { 
      status: "error", 
      error: `Publish failed: ${err instanceof Error ? err.message : String(err)}` 
    })
    throw err
  }
}

function onTaskFinished(
  projectPath: string,
  llmConfig: LlmConfig,
) {
  setTimeout(() => processQueue(projectPath, llmConfig), 100)
}

/**
 * Scans the project's research directory and loads existing results into the store.
 */
export async function loadPreviousResearch(projectPath: string) {
  const store = useResearchStore.getState()
  const researchDir = `${normalizePath(projectPath)}/research`
  
  try {
    const { listDirectory, fileExists } = await import("@/commands/fs")
    if (!(await fileExists(researchDir))) return

    const files = await listDirectory(researchDir)
    const mdFiles = files.filter(f => !f.is_dir && f.name.endsWith(".md"))

    const tasks: ResearchTask[] = mdFiles.map(f => {
      // Parse topic from filename: Research-Topic-Date-Time.md
      const name = f.name.replace(/\.md$/, "")
      const parts = name.split("-")
      let topic = parts.slice(1, -2).join("-") // Topic can have hyphens
      if (!topic && parts.length > 1) topic = parts[1] // Fallback
      if (!topic) topic = name

      return {
        id: `prev-${crypto.randomUUID()}`,
        topic: topic,
        status: "done",
        webResults: [], // Web results are not persisted in MD, but we can at least show the task
        synthesis: "", // Content is only loaded on demand (handleOpenSaved)
        savedPath: f.path,
        error: null,
        createdAt: Date.now() // Precise time not stored in filename yet
      }
    })

    store.addTasksUnique(tasks)
  } catch (err) {
    console.error("Failed to load previous research:", err)
  }
}
