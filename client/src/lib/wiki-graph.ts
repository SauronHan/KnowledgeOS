
import Graph from "graphology"
import louvain from "graphology-communities-louvain"

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  description?: string
  linkCount: number // inbound + outbound
  community: number // community id from Louvain detection
}

export interface GraphEdge {
  source: string
  target: string
  weight: number // relevance score between source and target
}

export interface CommunityInfo {
  id: number
  nodeCount: number
  cohesion: number // intra-community edge density
  topNodes: string[] // top nodes by linkCount (labels)
}

/** Run Louvain community detection and compute cohesion per community */
function detectCommunities(
  nodes: { id: string; label: string; linkCount: number }[],
  edges: GraphEdge[],
): { assignments: Map<string, number>; communities: CommunityInfo[] } {
  if (nodes.length === 0) {
    return { assignments: new Map(), communities: [] }
  }

  const g = new Graph({ type: "undirected" })
  for (const node of nodes) {
    g.addNode(node.id)
  }
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      const key = `${edge.source}->${edge.target}`
      if (!g.hasEdge(key) && !g.hasEdge(`${edge.target}->${edge.source}`)) {
        g.addEdgeWithKey(key, edge.source, edge.target, { weight: edge.weight })
      }
    }
  }

  // Run Louvain — returns { nodeId: communityId }
  const communityMap: Record<string, number> = louvain(g, { resolution: 1 })
  const assignments = new Map(Object.entries(communityMap).map(([k, v]) => [k, v as number]))

  // Group nodes by community
  const groups = new Map<number, string[]>()
  for (const [nodeId, commId] of assignments) {
    const list = groups.get(commId) ?? []
    list.push(nodeId)
    groups.set(commId, list)
  }

  // Build edge lookup for cohesion calculation
  const edgeSet = new Set<string>()
  for (const edge of edges) {
    edgeSet.add(`${edge.source}:::${edge.target}`)
    edgeSet.add(`${edge.target}:::${edge.source}`)
  }

  // Build label + linkCount lookup
  const nodeInfo = new Map(nodes.map((n) => [n.id, { label: n.label, linkCount: n.linkCount }]))

  // Compute per-community info
  const communities: CommunityInfo[] = []
  for (const [commId, memberIds] of groups) {
    const n = memberIds.length
    // Cohesion = actual intra-community edges / possible edges
    let intraEdges = 0
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        if (edgeSet.has(`${memberIds[i]}:::${memberIds[j]}`)) {
          intraEdges++
        }
      }
    }
    const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 1
    const cohesion = intraEdges / possibleEdges

    // Top nodes by linkCount
    const sorted = [...memberIds].sort(
      (a, b) => (nodeInfo.get(b)?.linkCount ?? 0) - (nodeInfo.get(a)?.linkCount ?? 0),
    )
    const topNodes = sorted.slice(0, 5).map((id) => nodeInfo.get(id)?.label ?? id)

    communities.push({ id: commId, nodeCount: n, cohesion, topNodes })
  }

  // Sort by nodeCount descending
  communities.sort((a, b) => b.nodeCount - a.nodeCount)

  // Re-number community IDs sequentially (0, 1, 2, ...)
  const idRemap = new Map<number, number>()
  communities.forEach((c, idx) => {
    idRemap.set(c.id, idx)
    c.id = idx
  })
  for (const [nodeId, oldId] of assignments) {
    assignments.set(nodeId, idRemap.get(oldId) ?? 0)
  }

  return { assignments, communities }
}



import { kosApiRequest } from "./api-client"

export async function buildWikiGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] }> {
  try {
    // In SaaS mode, we fetch the aggregated graph from the backend.
    const json = await kosApiRequest("/graph")
    const data = json.data
    
    const rawNodes: GraphNode[] = data.nodes || []
    const rawEdges: GraphEdge[] = data.edges || []
    
    // Count link references
    const linkCounts = new Map<string, number>()
    for (const node of rawNodes) {
      linkCounts.set(node.id, 0)
    }
    
    const dedupedEdges: GraphEdge[] = []
    const seenEdges = new Set<string>()
    
    for (const edge of rawEdges) {
      if (!linkCounts.has(edge.source) || !linkCounts.has(edge.target)) {
        continue // Skip invalid edges
      }
      
      const key = `${edge.source}:::${edge.target}`
      const reverseKey = `${edge.target}:::${edge.source}`
      
      if (!seenEdges.has(key) && !seenEdges.has(reverseKey)) {
        seenEdges.add(key)
        dedupedEdges.push({ source: edge.source, target: edge.target, weight: edge.weight || 1 })
      }
      
      linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1)
      linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1)
    }
    
    // Build preliminary nodes for community detection
    const prelimNodes = rawNodes.map((n) => ({
      id: n.id,
      label: n.label,
      linkCount: linkCounts.get(n.id) ?? 0,
    }))

    const { assignments, communities } = detectCommunities(prelimNodes, dedupedEdges)

    const nodes: GraphNode[] = rawNodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      path: n.path,
      description: (n as any).description,
      linkCount: linkCounts.get(n.id) ?? 0,
      community: assignments.get(n.id) ?? 0,
    }))

    return { nodes, edges: dedupedEdges, communities }
  } catch (err) {
    console.error("Error building global graph:", err)
    return { nodes: [], edges: [], communities: [] }
  }
}


