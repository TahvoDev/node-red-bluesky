const { AtpAgent } = require('@atproto/api');

// Store active service instances
const blueskyServices = new Map();

/**
 * Get or create a Bluesky service instance for the given config
 */
async function getBlueskyAgent(configNode) {
    return new Promise((resolve, reject) => {
        let bot = blueskyServices.get(configNode.id);

        if (!bot) {
            const agent = new AtpAgent({ service: 'https://bsky.social' });
            
            agent.login({ 
                identifier: configNode.username, 
                password: configNode.password 
            })
            .then(() => {
                bot = {
                    agent,
                    numReferences: 1,
                    id: configNode.id
                };
                blueskyServices.set(configNode.id, bot);
                resolve(bot);
            })
            .catch(err => {
                reject(err);
            });
        } else {
            // Existing bot, increment reference count
            bot.numReferences += 1;
            resolve(bot);
        }
    });
}

/**
 * Close a bot instance and clean up if no more references exist
 */
function closeBot(bot) {
    bot.numReferences -= 1;
    
    setTimeout(() => {
        if (bot.numReferences <= 0) {
            try {
                // Clean up any resources if needed
                // AtpAgent doesn't have a destroy/disconnect method
                blueskyServices.delete(bot.id);
            } catch (e) {
                console.error('Error cleaning up Bluesky bot:', e);
            }
        }
    }, 1000);
}

class BlueskyService {
    constructor(configNode) {
        this.bot = null;
        this.configNode = configNode;
    }

    async init() {
        if (!this.bot) {
            this.bot = await getBlueskyAgent(this.configNode);
        }
    }

    async post(message) {
        if (!this.bot) {
            throw new Error('Bluesky service not initialized');
        }
        await this.bot.agent.post({ text: message });
    }

    close() {
        if (this.bot) {
            closeBot(this.bot);
            this.bot = null;
        }
    }
}

module.exports = { BlueskyService, getBlueskyAgent, closeBot };