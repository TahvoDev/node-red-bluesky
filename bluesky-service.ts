import { AtpAgent } from '@atproto/api';

class BlueskyService  {
    agent!: AtpAgent;

    async init(username: string, password: string): Promise<void> {
        this.agent = new AtpAgent({service: 'https://bsky.social'});

        await this.agent.login({ identifier: username, password });
    }

    async post(message: string): Promise<void> {
        await this.agent.post({ text: message });
    }   
}