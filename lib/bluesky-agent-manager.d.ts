import { AtpAgent } from '@atproto/api';
interface BlueskyBot {
    agent: AtpAgent;
    numReferences: number;
    id: string;
}
/**
 * Get or create a Bluesky service instance for the given config
 */
declare function getBlueskyAgent(configNode: any): Promise<BlueskyBot>;
/**
 * Close a bot instance and clean up if no more references exist
 */
declare function closeBot(bot: BlueskyBot): void;
declare class BlueskyService {
    private bot;
    private configNode;
    constructor(configNode: any);
    init(): Promise<void>;
    post(message: string): Promise<void>;
    close(): void;
}
export { BlueskyService, getBlueskyAgent, closeBot };
