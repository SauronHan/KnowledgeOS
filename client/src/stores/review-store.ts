import { create } from "zustand"
import { normalizeReviewTitle } from "@/lib/review-utils"

export interface ReviewOption {
  label: string
  action: string // identifier for the action
}

export interface ReviewItem {
  id: string
  type: "contradiction" | "duplicate" | "missing-page" | "confirm" | "suggestion" | "backend-audit"
  title: string
  description: string
  sourcePath?: string
  affectedPages?: string[]
  searchQueries?: string[]
  options: ReviewOption[]
  resolved: boolean
  resolvedAction?: string
  createdAt: number
}

interface ReviewState {
  items: ReviewItem[]
  addItem: (item: Omit<ReviewItem, "id" | "resolved" | "createdAt">) => void
  addItems: (items: Omit<ReviewItem, "id" | "resolved" | "createdAt">[]) => void
  setItems: (items: ReviewItem[]) => void
  resolveItem: (id: string, action: string) => void
  dismissItem: (id: string) => void
  clearResolved: () => void
  syncBackendAudits: (serverUrl: string) => Promise<void>
}

let counter = 0

export const useReviewStore = create<ReviewState>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => ({
      items: [
        ...state.items,
        {
          ...item,
          id: `review-${++counter}`,
          resolved: false,
          createdAt: Date.now(),
        },
      ],
    })),

  addItems: (items) =>
    set((state) => {
      // De-dupe against pending items with same type + normalized title (all
      // 5 types — bulk ingest can re-surface the same contradiction/confirm
      // from multiple files).
      // Merge affectedPages / searchQueries / sourcePath instead of duplicating.
      const result = [...state.items]
      const keyFor = (t: string, title: string) => `${t}::${normalizeReviewTitle(title)}`

      // Build index of existing pending items for fast lookup
      const pendingIndex = new Map<string, number>()
      result.forEach((it, idx) => {
        if (!it.resolved) {
          pendingIndex.set(keyFor(it.type, it.title), idx)
        }
      })

      for (const incoming of items) {
        const k = keyFor(incoming.type, incoming.title)
        const existingIdx = pendingIndex.get(k)

        if (existingIdx !== undefined) {
          // Merge into existing
          const old = result[existingIdx]
          const mergedPages = Array.from(new Set([...(old.affectedPages ?? []), ...(incoming.affectedPages ?? [])]))
          const mergedQueries = Array.from(new Set([...(old.searchQueries ?? []), ...(incoming.searchQueries ?? [])]))
          result[existingIdx] = {
            ...old,
            description: incoming.description || old.description, // prefer newer description
            sourcePath: incoming.sourcePath ?? old.sourcePath,
            affectedPages: mergedPages.length > 0 ? mergedPages : undefined,
            searchQueries: mergedQueries.length > 0 ? mergedQueries : undefined,
          }
        } else {
          const newItem = {
            ...incoming,
            id: `review-${++counter}`,
            resolved: false,
            createdAt: Date.now(),
          }
          result.push(newItem)
          pendingIndex.set(k, result.length - 1)
        }
      }

      return { items: result }
    }),

  setItems: (items) => set({ items }),

  resolveItem: (id, action) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, resolved: true, resolvedAction: action } : item
      ),
    })),

  dismissItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearResolved: () =>
    set((state) => ({
      items: state.items.filter((item) => !item.resolved),
    })),

  syncBackendAudits: async (serverUrl: string) => {
    try {
      const res = await fetch(`${serverUrl}/api/v1/audit/pending`)
      if (!res.ok) return
      const json = await res.json()
      if (json.status !== "success" || !json.data) return

      const backendDocs: Array<{ id: number; filename: string }> = json.data
      const newItems: Omit<ReviewItem, "id" | "resolved" | "createdAt">[] = backendDocs.map((doc) => ({
        type: "backend-audit",
        title: `Audit Request: ${doc.filename}`,
        description: `Server finished processing ${doc.filename}. Please approve to ingest into the knowledge graph.`,
        sourcePath: doc.filename,
        options: [
          { label: "Approve", action: `backend_approve:${doc.id}` },
          { label: "Reject", action: `backend_reject:${doc.id}` },
        ],
      }))

      // Filter out existing pending backend audits so we don't duplicate them locally
      set((state) => {
        // Keep all local items and resolved items, but discard UNRESOLVED backend-audits
        // so we can cleanly replace them with the fresh server list.
        const filteredItems = state.items.filter((it) => it.resolved || it.type !== "backend-audit")
        const freshItems = newItems.map((item) => ({
          ...item,
          id: `review-server-${item.options[0].action}`, // Stable ID based on doc ID
          resolved: false,
          createdAt: Date.now(),
        }))
        return { items: [...filteredItems, ...freshItems] }
      })
    } catch (err) {
      console.error("Failed to sync backend audits:", err)
    }
  },
}))
