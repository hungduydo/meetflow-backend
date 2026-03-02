/**
 * B2.1: Fetch the rolling transcript context for a meeting.
 * Maintains the last 10-20 minutes of conversation in the prompt buffer.
 */
export declare function getMeetingContext(meetingId: string, windowMs?: number): Promise<string>;
export interface SmartReply {
    professional: string;
    casual: string;
    concise: string;
}
export declare function generateSmartReplies(meetingId: string, triggerText: string, ragContext?: string): Promise<SmartReply>;
export interface MeetingMinutes {
    summary: string;
    actionItems: {
        task: string;
        assignee: string | null;
        dueDate: string | null;
    }[];
    decisions: {
        decision: string;
        context: string;
    }[];
    keyTopics: string[];
}
export declare function generateMeetingMinutes(meetingId: string): Promise<MeetingMinutes>;
export declare function magicSearch(meetingId: string, query: string): Promise<{
    answer: string;
    relevantQuotes: {
        speaker: string;
        text: string;
        relevance: string;
    }[];
}>;
//# sourceMappingURL=llm.service.d.ts.map