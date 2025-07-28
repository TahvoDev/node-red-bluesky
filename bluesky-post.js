module.exports = function(RED) {
    var blueskyService = require('./lib/bluesky-agent-manager.js');
    const { RichText } = require('@atproto/api');
    const https = require('https');
    const { promisify } = require('util');
    const stream = require('stream');
    const pipeline = promisify(stream.pipeline);
    const { v4: uuidv4 } = require('uuid');

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

    /**
     * Download image from URL and upload as blob
     * @param {object} agent - Bluesky agent
     * @param {string} imageUrl - URL of the image to download
     * @returns {Promise<object>} Blob reference
     */
    async function uploadImageFromUrl(agent, imageUrl) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const client = imageUrl.startsWith('https') ? https : require('http');
            
            client.get(imageUrl, async (response) => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(new Error(`Failed to download image: ${response.statusCode}`));
                }

                const contentType = response.headers['content-type'];
                if (!contentType || !contentType.startsWith('image/')) {
                    return reject(new Error('URL does not point to a valid image'));
                }

                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', async () => {
                    try {
                        const imageData = Buffer.concat(chunks);
                        if (imageData.length > 5 * 1024 * 1024) {
                            return reject(new Error('Image size exceeds 5MB limit'));
                        }

                        // Upload the image as a blob
                        const blobRef = await agent.uploadBlob(imageData, { 
                            encoding: contentType || 'image/jpeg',
                            filename: `image-${uuidv4()}.${contentType.split('/')[1] || 'jpg'}`
                        });
                        
                        resolve(blobRef.data.blob);
                    } catch (error) {
                        reject(error);
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Format a post with optional embed
     * @param {object} agent - Bluesky agent
     * @param {object} msg - The input message
     * @returns {Promise<object>} Formatted post data
     */
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
            const post = {
                $type: 'app.bsky.feed.post',
                text: msg.payload.text || '',
                facets: msg.payload.facets,
                createdAt: msg.payload.date ? new Date(msg.payload.date).toISOString() : new Date().toISOString()
            };

            // Handle embed if provided
            if (msg.payload.embed) {
                // Process embed asynchronously
                try {
                    // Handle website card embed
                    if (msg.payload.embed.$type === 'app.bsky.embed.external') {
                        const embedData = {
                            $type: 'app.bsky.embed.external',
                            external: {
                                uri: msg.payload.embed.uri,
                                title: msg.payload.embed.title || '',
                                description: msg.payload.embed.description || ''
                            }
                        };

                        // Handle thumbnail URL if provided
                        if (typeof msg.payload.embed.thumb === 'string' && 
                            (msg.payload.embed.thumb.startsWith('http://') || 
                             msg.payload.embed.thumb.startsWith('https://'))) {
                            try {
                                embedData.external.thumb = await uploadImageFromUrl(agent, msg.payload.embed.thumb);
                            } catch (error) {
                                console.warn('Failed to upload thumbnail:', error.message);
                                // Continue without thumbnail if upload fails
                            }
                        } else if (msg.payload.embed.thumb) {
                            // Use provided thumb as is (assumes it's already a BlobRef)
                            embedData.external.thumb = msg.payload.embed.thumb;
                        }

                        post.embed = embedData;
                    } 
                // Handle image embed (for reference)
                else if (msg.payload.embed.$type === 'app.bsky.embed.images' && 
                         Array.isArray(msg.payload.embed.images)) {
                    post.embed = {
                        $type: 'app.bsky.embed.images',
                        images: msg.payload.embed.images
                            .filter(img => img && img.image) // Ensure valid images
                            .slice(0, 4) // Max 4 images
                    };
                }
                    // Handle other embed types by passing them through
                    else {
                        post.embed = msg.payload.embed;
                    }
                } catch (error) {
                    console.error('Error processing embed:', error);
                    throw new Error(`Failed to process embed: ${error.message}`);
                }
            }

            return post;
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