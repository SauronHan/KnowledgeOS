export interface WikiProject {
  /** Stable UUID, persisted inside the project at .llm-wiki/project.json.
   *  Survives the user moving or renaming the project folder. */
  id: string
  name: string
  path: string
  serverId?: number
  visibility?: "private" | "shared"
  isReadonly?: boolean
  /** Server-side package version (shared projects only) */
  packageVersion?: number
  /** Server-side package filename (shared projects only) */
  packageFilename?: string
}

export interface FileNode {
  name: string
  path: string
  is_dir: boolean
  children?: FileNode[]
  serverStatus?: string
  sourceUrl?: string | null
}

export interface WikiPage {
  path: string
  content: string
  frontmatter: Record<string, unknown>
}
