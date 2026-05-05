


export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export async function webSearch(
  query: string,
  maxResults: number = 10,
): Promise<WebSearchResult[]> {
  // Use backend proxy for web search to protect API keys in SaaS mode
  const token = localStorage.getItem("kos_auth_token")
  const serverConfigStr = localStorage.getItem("kos_server_config")
  let serverUrl = "http://127.0.0.1:8080"
  
  if (serverConfigStr) {
    try {
      const config = JSON.parse(serverConfigStr)
      if (config.url) serverUrl = config.url
    } catch {}
  }

  const response = await fetch(`${serverUrl}/api/v1/web-search?query=${encodeURIComponent(query)}&max_results=${maxResults}`, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.detail || `Search failed: ${response.status}`)
  }

  const data = await response.json()
  return data.results || []
}

// tavilySearch is now handled by the backend proxy.

