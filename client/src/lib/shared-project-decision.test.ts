import { describe, it, expect } from "vitest"

/**
 * Tests for the version comparison and download decision logic used in
 * App.tsx handleSelectRecent for shared projects.
 *
 * Decision matrix:
 * | Local version | Server version | Result                          |
 * |---------------|----------------|---------------------------------|
 * | null          | 0              | Alert "not published" → stop   |
 * | null          | >0             | Show download dialog            |
 * | < server      | > local        | Prompt update / open old        |
 * | >= server     | >= local       | Open local directly             |
 */

export type Decision =
  | { action: "block_not_published" }
  | { action: "show_download_dialog"; version: number }
  | { action: "prompt_update"; localVersion: number; serverVersion: number }
  | { action: "open_local"; version: number }

export function decideSharedProjectAction(
  localVersion: number | null,
  serverVersion: number,
): Decision {
  if (serverVersion === 0) {
    return { action: "block_not_published" }
  }

  if (localVersion === null) {
    return { action: "show_download_dialog", version: serverVersion }
  }

  if (localVersion < serverVersion) {
    return {
      action: "prompt_update",
      localVersion,
      serverVersion,
    }
  }

  return { action: "open_local", version: localVersion }
}

describe("decideSharedProjectAction", () => {
  it("blocks when server version is 0 (not published)", () => {
    const result = decideSharedProjectAction(null, 0)
    expect(result.action).toBe("block_not_published")
  })

  it("blocks when server version is 0 even if local exists", () => {
    const result = decideSharedProjectAction(5, 0)
    expect(result.action).toBe("block_not_published")
  })

  it("shows download dialog when no local copy and server published", () => {
    const result = decideSharedProjectAction(null, 3)
    expect(result).toEqual({ action: "show_download_dialog", version: 3 })
  })

  it("opens local directly when versions match", () => {
    const result = decideSharedProjectAction(2, 2)
    expect(result).toEqual({ action: "open_local", version: 2 })
  })

  it("opens local directly when local is newer (shouldn't happen normally)", () => {
    const result = decideSharedProjectAction(5, 3)
    expect(result).toEqual({ action: "open_local", version: 5 })
  })

  it("prompts update when local version is older", () => {
    const result = decideSharedProjectAction(1, 3)
    expect(result).toEqual({
      action: "prompt_update",
      localVersion: 1,
      serverVersion: 3,
    })
  })

  it("prompts update from version 0 to 1", () => {
    const result = decideSharedProjectAction(0, 1)
    expect(result).toEqual({
      action: "prompt_update",
      localVersion: 0,
      serverVersion: 1,
    })
  })

  it("shows download for first-time user with v5 package", () => {
    const result = decideSharedProjectAction(null, 5)
    expect(result).toEqual({ action: "show_download_dialog", version: 5 })
  })

  it("opens local for user already on latest", () => {
    const result = decideSharedProjectAction(10, 10)
    expect(result).toEqual({ action: "open_local", version: 10 })
  })
})
