from pydantic import BaseModel, Field
from typing import List, Optional

class ConceptExtraction(BaseModel):
    name: str = Field(description="Name of the concept or entity.")
    description: str = Field(description="Brief explanation of what this is.")
    entity_type: str = Field(description="Type: 'Entity', 'Concept', 'Event', 'Person', etc.")

class ContradictionAnalysis(BaseModel):
    claim_in_source: str
    conflicting_claim_in_wiki: str = Field(description="If no conflict, leave empty")
    resolution_suggestion: str

class Step1AnalysisOutput(BaseModel):
    key_takeaways: List[str] = Field(description="Main points extracted from the document.")
    new_concepts: List[ConceptExtraction] = Field(description="List of newly discovered entities or concepts.")
    contradictions: List[ContradictionAnalysis] = Field(description="Any contradictions found compared to existing knowledge.")
    structure_suggestions: str = Field(description="Suggestions on how to weave this into the current wiki.")

class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str = Field(description="How the source relates to the target.")

class Step2GenerationOutput(BaseModel):
    summary_markdown: str = Field(description="The main markdown content to be saved as the source summary.")
    nodes_to_create: List[ConceptExtraction] = Field(description="Finalized list of concept pages to create.")
    edges_to_create: List[GraphEdge] = Field(description="Relationships between nodes (e.g., [[wikilinks]] logic mapped to edges).")
    requires_human_review: bool = Field(description="Set to true if LLM is unsure about some classifications.")
    suggested_research_queries: List[str] = Field(description="If knowledge gaps are found, suggest search queries for deep research.")
