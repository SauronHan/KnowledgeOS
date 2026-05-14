import { writeFile, readFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface SharedMeta {
  project_uuid: string
  version: number
  downloaded_at: string
  package_filename: string
}

const SHARED_META_FILENAME = "shared-meta.json"

export function getSharedMetaPath(projectPath: string): string {
  const pp = normalizePath(projectPath)
  return `${pp}/.llm-wiki/${SHARED_META_FILENAME}`
}

export async function readSharedMeta(projectPath: string): Promise<SharedMeta | null> {
  const metaPath = getSharedMetaPath(projectPath)
  try {
    const exists = await fileExists(metaPath)
    if (!exists) return null
    const content = await readFile(metaPath)
    return JSON.parse(content) as SharedMeta
  } catch {
    return null
  }
}

export async function writeSharedMeta(projectPath: string, meta: SharedMeta): Promise<void> {
  const metaPath = getSharedMetaPath(projectPath)
  const pp = normalizePath(projectPath)
  await writeFile(`${pp}/.llm-wiki/.gitkeep`, "")
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
