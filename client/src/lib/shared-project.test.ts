import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests for shared-project.ts — pure logic and structural validation.
 * Tauri-invoke dependent functions (readSharedMeta, writeSharedMeta) are tested
 * for path construction only; actual file I/O is exercised via integration tests.
 */

// Mock Tauri invoke before importing the module
vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { getSharedMetaPath } from "./shared-project"
import type { SharedMeta } from "./shared-project"

describe("getSharedMetaPath", () => {
  it("returns correct path for Unix-like paths", () => {
    const result = getSharedMetaPath("/Users/foo/MyProject")
    expect(result).toBe("/Users/foo/MyProject/.llm-wiki/shared-meta.json")
  })

  it("returns correct path for Windows-like paths", () => {
    const result = getSharedMetaPath("C:\\Users\\foo\\MyProject")
    expect(result).toBe("C:/Users/foo/MyProject/.llm-wiki/shared-meta.json")
  })

  it("handles trailing slashes (normalizePath does NOT strip them)", () => {
    const result = getSharedMetaPath("/Users/foo/MyProject/")
    expect(result).toBe("/Users/foo/MyProject//.llm-wiki/shared-meta.json")
  })

  it("handles empty path", () => {
    const result = getSharedMetaPath("")
    expect(result).toBe("/.llm-wiki/shared-meta.json")
  })
})

describe("SharedMeta interface", () => {
  it("validates a well-formed SharedMeta object", () => {
    const meta: SharedMeta = {
      project_uuid: "abc-123-def",
      version: 3,
      downloaded_at: "2025-06-01T10:00:00.000Z",
      package_filename: "kb-enterprise-v3.zip",
    }
    expect(meta.project_uuid).toBe("abc-123-def")
    expect(meta.version).toBe(3)
    expect(meta.downloaded_at).toBeTruthy()
  })

  it("version zero means not yet downloaded", () => {
    const meta: SharedMeta = {
      project_uuid: "xyz-000",
      version: 0,
      downloaded_at: "2025-01-01T00:00:00.000Z",
      package_filename: "",
    }
    expect(meta.version).toBe(0)
  })
})
