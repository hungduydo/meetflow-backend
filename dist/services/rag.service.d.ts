export declare function ingestDocument(documentId: string, userId: string, rawText: string): Promise<{
    chunkCount: number;
}>;
export interface RAGResult {
    content: string;
    similarity: number;
    documentId: string;
}
export declare function searchKnowledgeBase(query: string, userId: string, matchCount?: number): Promise<RAGResult[]>;
export declare function formatRAGContext(results: RAGResult[]): string;
//# sourceMappingURL=rag.service.d.ts.map