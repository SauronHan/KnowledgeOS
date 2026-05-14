import { useState } from "react"
import { Globe, CheckCircle, XCircle, Loader2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getServerUrl, setServerUrl } from "@/lib/api-client"

interface Props {
  onContinue: () => void
}

export function ServerConfigScreen({ onContinue }: Props) {
  const [url, setUrl] = useState(() => getServerUrl())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null)
  const [testError, setTestError] = useState("")

  const handleTest = async () => {
    const trimmed = url.trim().replace(/\/+$/, "")
    if (!trimmed) return

    setTesting(true)
    setTestResult(null)
    setTestError("")

    try {
      const response = await fetch(`${trimmed}/health`, {
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (data.status === "ok") {
        setTestResult("ok")
        setServerUrl(trimmed)
      } else {
        setTestResult("fail")
        setTestError("Unexpected response from server")
      }
    } catch (err: any) {
      setTestResult("fail")
      setTestError(err.message || "Cannot reach server")
    } finally {
      setTesting(false)
    }
  }

  const handleContinue = async () => {
    const trimmed = url.trim().replace(/\/+$/, "")
    setServerUrl(trimmed)
    // Persist to app-state.json so the setting survives restart
    try {
      const { saveServerConfig } = await import("@/lib/project-store")
      await saveServerConfig({ url: trimmed })
    } catch {
      // Non-critical — at least localStorage is set
    }
    onContinue()
  }

  const canContinue = testResult === "ok"

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Lyrebird KOS</h1>
          <p className="mt-2 text-sm text-slate-500">
            Configure your KnowledgeOS server to continue
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Server API URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setTestResult(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTest()
              }}
              placeholder="http://127.0.0.1:8080"
              className="block w-full rounded-md border border-slate-300 py-2 px-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="w-full"
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Globe className="mr-2 h-4 w-4" />
            )}
            Test Connection
          </Button>

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-md p-3 text-sm ${
                testResult === "ok"
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {testResult === "ok" ? (
                <>
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  Connection successful — KnowledgeOS server is reachable
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 shrink-0" />
                  Connection failed: {testError}
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 border-t pt-4">
          <Button
            onClick={handleContinue}
            disabled={!canContinue}
            className="w-full"
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            Continue to Login
          </Button>
          {!canContinue && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Test the connection first before continuing
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
