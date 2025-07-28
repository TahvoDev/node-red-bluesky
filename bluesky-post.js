module.exports = function(RED) {
    var blueskyService = require('./lib/bluesky-agent-manager.js');

    function formatPost(msg) {
        let post;
        if (typeof msg.payload === 'string' || typeof msg.payload === 'number' || typeof msg.payload === 'boolean') 
        {
            post = {
                text: msg.payload,
                createdAt: new Date().toISOString()
            };
        } 
        else if (typeof msg.payload === 'object' && msg.payload !== null)
        {
            post = {
                text: msg.payload.text || '',
                createdAt: msg.payload.date ? new Date(msg.payload.date).toISOString() : new Date().toISOString()
            };
        }
        else
        {
            throw new Error('Invalid payload format. Expected string or object with text and optional date.');
        }

        return post;
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

                    bot.agent.post(formatPost(msg))
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