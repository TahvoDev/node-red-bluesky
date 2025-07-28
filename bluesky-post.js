module.exports = function(RED) {
    var blueskyService = require('./lib/bluesky-agent-manager.js');
    const { RichText } = require('@atproto/api');

    /**
     * Process and validate facets in a RichText object
     * @param {object} rt - The RichText instance to process
     * @param {object} agent - The Bluesky agent for facet detection
     * @returns {Promise<object>} Processed RichText object with validated facets
     */
    async function processFacets(rt, agent) {
        // Only detect facets if the text contains potential mentions, links, or hashtags
        if (!rt.text.includes('@') && !rt.text.includes('http://') && !rt.text.includes('https://') && !rt.text.includes('#')) {
            return rt;
        }

        try {
            await rt.detectFacets(agent);
            
            // Only filter out invalid mentions, keep all other facets
            if (rt.facets) {
                rt.facets = rt.facets
                    .map(facet => ({
                        ...facet,
                        features: facet.features.filter(feature => {
                            // Only filter out invalid mentions, keep all other features including hashtags and links
                            if (feature.$type === 'app.bsky.richtext.facet#mention') {
                                return feature.did && /^did:[a-z0-9]+:[a-zA-Z0-9._-]+$/.test(feature.did);
                            }
                            // Keep all hashtags and other valid features
                            return true;
                        })
                    }))
                    .filter(facet => facet.features.length > 0); // Remove facets with no valid features
            }
        } catch (err) {
            // If facet detection fails, just post the text without facets
            console.warn('Error detecting facets, posting as plain text:', err.message);
        }
        
        return rt;
    }

    async function formatPost(agent, msg) {
        if (typeof msg.payload === 'number' || typeof msg.payload === 'boolean') {
            return {
                $type: 'app.bsky.feed.post',
                text: msg.payload.toString(),
                createdAt: new Date().toISOString()
            };
        } 
        
        if (typeof msg.payload === 'string') {
            const rt = new RichText({ text: msg.payload.trim() });
            await processFacets(rt, agent);
            
            return {
                $type: 'app.bsky.feed.post',
                text: rt.text,
                facets: rt.facets,
                createdAt: new Date().toISOString()
            };
        }
        
        if (typeof msg.payload === 'object' && msg.payload !== null) {
            return {
                $type: 'app.bsky.feed.post',
                text: msg.payload.text || '',
                facets: msg.payload.facets,
                createdAt: msg.payload.date ? new Date(msg.payload.date).toISOString() : new Date().toISOString()
            };
        }
        
        throw new Error('Invalid payload format. Expected string, number, boolean, or object with text and optional date.');
    }

    function BlueskyPostNode(config) {
        RED.nodes.createNode(this, config);
        var configNode = RED.nodes.getNode(config.config);
        var node = this;

        if (!configNode) {
            node.error("Missing Bluesky configuration");
            return;
        }

        // Initialize the agent
        blueskyService.getBlueskyAgent(configNode)
            .then(function(bot) {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "ready"
                });

                // Set up input handler
                node.on('input', function(msg) {
                    node.status({ fill: "blue", shape: "dot", text: "posting..." });
                    
                    const message = typeof msg.payload === 'string' ? msg.payload : 
                                  (msg.payload.text || JSON.stringify(msg.payload));
                    
                    if (!message) {
                        node.error("No message content provided in msg.payload");
                        node.status({ fill: "red", shape: "ring", text: "error" });
                        return;
                    }

                    formatPost(bot.agent, msg)
                        .then(post => bot.agent.post(post))
                    .then(() => {
                        node.status({ fill: "green", shape: "dot", text: "posted" });
                    })
                        .catch(err => {
                            node.error("Error posting to Bluesky: " + err.message);
                            node.status({ fill: "red", shape: "ring", text: "error" });
                        });
                });

                // Clean up on node removal
                node.on('close', function() {
                    if (bot && typeof bot.close === 'function') {
                        bot.close();
                    }
                    node.status({});
                });
            })
            .catch(function(err) {
                node.error("Failed to initialize Bluesky agent: " + err.message);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "connection error"
                });
            });
    }

    RED.nodes.registerType("bluesky-post", BlueskyPostNode);
}