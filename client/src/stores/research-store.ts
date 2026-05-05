import { create } from "zustand"
import type { WebSearchResult } from "@/lib/web-search"

export interface ResearchTask {
  id: string
  topic: string
  searchQueries?: string[]
  status: "queued" | "searching" | "synthesizing" | "saving" | "done" | "error"
  webResults: WebSearchResult[]
  synthesis: string
  savedPath: string | null
  error: string | null
  createdAt: number
}

interface ResearchState {
  tasks: ResearchTask[]
  panelOpen: boolean
  maxConcurrent: number

  addTask: (taskOrTopic: string | Partial<ResearchTask>) => string
  updateTask: (id: string, updates: Partial<ResearchTask>) => void
  removeTask: (id: string) => void
  setPanelOpen: (open: boolean) => void
  getRunningCount: () => number
  getNextQueued: () => ResearchTask | undefined
  addTasksUnique: (newTasks: ResearchTask[]) => void
}

let counter = 0

export const useResearchStore = create<ResearchState>((set, get) => ({
  tasks: [],
  panelOpen: false,
  maxConcurrent: 3,

  addTask: (taskOrTopic: string | Partial<ResearchTask>) => {
    const id = typeof taskOrTopic === "string" ? `research-${++counter}` : (taskOrTopic.id || `research-${++counter}`)
    const topic = typeof taskOrTopic === "string" ? taskOrTopic : (taskOrTopic.topic || "")
    
    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id,
          topic,
          status: "queued",
          webResults: [],
          synthesis: "",
          savedPath: null,
          error: null,
          createdAt: Date.now(),
          ...(typeof taskOrTopic === "object" ? taskOrTopic : {}),
        },
      ],
      panelOpen: true,
    }))
    return id
  },

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  getRunningCount: () => {
    const { tasks } = get()
    return tasks.filter((t) =>
      t.status === "searching" || t.status === "synthesizing" || t.status === "saving"
    ).length
  },

  getNextQueued: () => {
    const { tasks } = get()
    return tasks.find((t) => t.status === "queued")
  },
  
  addTasksUnique: (newTasks) => {
    set((state) => {
      const existingPaths = new Set(state.tasks.map(t => t.savedPath).filter(Boolean))
      const toAdd = newTasks.filter(t => !t.savedPath || !existingPaths.has(t.savedPath))
      if (toAdd.length === 0) return state
      return { tasks: [...state.tasks, ...toAdd] }
    })
  }
}))
