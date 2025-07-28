module.exports = function(RED) {
    var blueskyService = require('./lib/bluesky-agent-manager.js');
    const { RichText } = require('@atproto/api');

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
            
            // Only detect facets if the text contains potential mentions or links
            if (rt.text.includes('@') || rt.text.includes('http://') || rt.text.includes('https://')) {
                try {
                    await rt.detectFacets(agent);
                    // Filter out invalid facets (like email addresses)
                    if (rt.facets) {
                        rt.facets = rt.facets.filter(facet => {
                            // Keep only valid link facets and mentions with valid DIDs
                            return facet.features.every(feature => {
                                if (feature.$type === 'app.bsky.richtext.facet#link') return true;
                                if (feature.$type === 'app.bsky.richtext.facet#mention' && feature.did) {
                                    // Only keep mentions that look like valid DIDs
                                    return /^did:[a-z0-9]+:[a-zA-Z0-9._-]+$/.test(feature.did);
                                }
                                return false;
                            });
                        });
                    }
                } catch (err) {
                    // If facet detection fails, just post the text without facets
                    console.warn('Error detecting facets, posting as plain text:', err.message);
                }
            }
            
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