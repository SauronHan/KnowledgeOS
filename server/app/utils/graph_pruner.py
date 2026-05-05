from typing import Dict, Any, List

def prune_graph_data(extracted_data: Dict[str, Any], max_nodes: int = 150) -> Dict[str, Any]:
    """
    服务端图谱剪枝策略 (Server-Side Pruning)。
    防止千万级节点撑爆前端 Sigma.js 的 WebGL 渲染管线。
    """
    if not extracted_data:
        return extracted_data

    # 判断数据结构来源
    is_llm_wiki = "generation" in extracted_data
    
    if is_llm_wiki:
        nodes = extracted_data["generation"].get("nodes", [])
        edges = extracted_data["generation"].get("edges", [])
    else:
        nodes = extracted_data.get("nodes", [])
        edges = extracted_data.get("edges", [])

    if len(nodes) <= max_nodes:
        return extracted_data  # 节点数安全，原样返回

    print(f"[Graph Pruner] Triggered. Original nodes: {len(nodes)}, target: {max_nodes}")

    # 1. 计算每个节点的度数 (Degree = 边数)
    degrees = {}
    for edge in edges:
        # LLM-Wiki 的边通常有 source/target 字段
        # Graphify 的边可能有 src/dst 等，这里做个简单适配
        source = edge.get("source") or edge.get("src")
        target = edge.get("target") or edge.get("dst")
        
        if source:
            degrees[source] = degrees.get(source, 0) + 1
        if target:
            degrees[target] = degrees.get(target, 0) + 1

    # 2. 对节点按度数排序，找出“最核心的”节点
    # 如果节点没有关联任何边，度数默认为 0
    # 为了避免无边节点被完全剔除，可以按 "重要性" 或度数排序
    def get_node_id(n):
        return n.get("id") or n.get("name")

    sorted_nodes = sorted(nodes, key=lambda n: degrees.get(get_node_id(n), 0), reverse=True)
    
    # 3. 截断长尾节点
    kept_nodes = sorted_nodes[:max_nodes]
    kept_node_ids = {get_node_id(n) for n in kept_nodes}

    # 4. 过滤边 (只保留首尾都在 kept_nodes 里的关联关系)
    kept_edges = []
    for edge in edges:
        source = edge.get("source") or edge.get("src")
        target = edge.get("target") or edge.get("dst")
        if source in kept_node_ids and target in kept_node_ids:
            kept_edges.append(edge)

    # 5. 拼装返回
    # 需要深拷贝以避免污染原始数据
    import copy
    pruned_data = copy.deepcopy(extracted_data)
    
    if is_llm_wiki:
        pruned_data["generation"]["nodes"] = kept_nodes
        pruned_data["generation"]["edges"] = kept_edges
        pruned_data["generation"]["_pruned"] = True # 标记此数据已被剪枝
        pruned_data["generation"]["_original_node_count"] = len(nodes)
    else:
        pruned_data["nodes"] = kept_nodes
        pruned_data["edges"] = kept_edges
        pruned_data["_pruned"] = True
        pruned_data["_original_node_count"] = len(nodes)

    return pruned_data
