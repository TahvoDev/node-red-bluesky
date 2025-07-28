const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, (response) => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return reject(new Error(`Failed to download image: ${response.statusCode} ${response.statusMessage}`));
            }
            
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });
        }).on('error', reject);
    });
}

async function uploadImage(agent, imageConfig) {
    try {
        let imageData;
        
        if (typeof imageConfig.image === 'string') {
            // Check if it's a URL
            try {
                const url = new URL(imageConfig.image);
                if (['http:', 'https:'].includes(url.protocol)) {
                    // It's a URL, download the image
                    const buffer = await downloadImage(imageConfig.image);
                    imageData = new Uint8Array(buffer);
                } else {
                    // It's a file path
                    const imagePath = path.isAbsolute(imageConfig.image) 
                        ? imageConfig.image 
                        : path.join(process.cwd(), imageConfig.image);
                    
                    const fileData = await fs.readFile(imagePath);
                    imageData = new Uint8Array(fileData);
                }
            } catch (e) {
                // Not a valid URL, treat as file path
                const imagePath = path.isAbsolute(imageConfig.image) 
                    ? imageConfig.image 
                    : path.join(process.cwd(), imageConfig.image);
                
                const fileData = await fs.readFile(imagePath);
                imageData = new Uint8Array(fileData);
            }
        } else if (Buffer.isBuffer(imageConfig.image)) {
            // If it's already a buffer, convert to Uint8Array
            imageData = new Uint8Array(imageConfig.image);
        } else if (imageConfig.image instanceof Uint8Array) {
            // If it's already a Uint8Array, use it directly
            imageData = imageConfig.image;
        } else {
            throw new Error('Invalid image format. Must be a URL, file path, Buffer, or Uint8Array');
        }

        // Upload the image
        const upload = await agent.uploadBlob(imageData, {
            encoding: 'image/jpeg', // Default, can be overridden in imageConfig
            ...imageConfig
        });

        return {
            image: {
                $type: 'blob',
                ref: {
                    $link: upload.data.blob.ref.toString()
                },
                mimeType: upload.data.blob.mimeType,
                size: upload.data.blob.size
            },
            alt: imageConfig.alt || ''
        };
    } catch (error) {
        console.error('Error uploading image:', error);
        throw new Error(`Failed to upload image: ${error.message}`);
    }
}

module.exports = function(RED) {
    var blueskyService = require('./lib/bluesky-agent-manager.js');

    async function formatPost(agent, msg) {
        const now = new Date().toISOString();
        
        // Process images if present
        let embeds = [];
        if (msg.payload.images && Array.isArray(msg.payload.images) && msg.payload.images.length > 0) {
            try {
                const imageEmbeds = await Promise.all(
                    msg.payload.images.map(img => uploadImage(agent, img))
                );
                
                if (imageEmbeds.length === 1) {
                    // Single image
                    embeds.push({
                        $type: 'app.bsky.embed.images#view',
                        images: [imageEmbeds[0]]
                    });
                } else if (imageEmbeds.length > 1) {
                    // Multiple images (up to 4)
                    embeds.push({
                        $type: 'app.bsky.embed.images#view',
                        images: imageEmbeds.slice(0, 4) // Bluesky supports up to 4 images
                    });
                }
            } catch (error) {
                throw new Error(`Image processing failed: ${error.message}`);
            }
        }
        
        // If payload is a simple type, convert it to a simple post
        if (typeof msg.payload === 'string' || typeof msg.payload === 'number' || typeof msg.payload === 'boolean') {
            return {
                text: String(msg.payload),
                type: 'post',
                createdAt: now
            };
        }
        
        // If payload is an object, process it based on type
        if (typeof msg.payload === 'object' && msg.payload !== null) {
            const post = {
                text: msg.payload.text || '',
                type: msg.payload.type || 'post',
                createdAt: msg.payload.date ? new Date(msg.payload.date).toISOString() : now,
                langs: msg.payload.langs || ['en'],
                ...(embeds.length > 0 && { embeds })
            };

            // Add type-specific fields
            switch (post.type) {
                case 'reply':
                    if (!msg.payload.replyTo || !msg.payload.replyTo.rootUri || !msg.payload.replyTo.parentUri) {
                        throw new Error("For 'reply' type, replyTo object with rootUri and parentUri is required.");
                    }
                    post.reply = {
                        root: { 
                            uri: msg.payload.replyTo.rootUri, 
                            cid: msg.payload.replyTo.rootCid || '' 
                        },
                        parent: { 
                            uri: msg.payload.replyTo.parentUri, 
                            cid: msg.payload.replyTo.parentCid || '' 
                        }
                    };
                    break;

                case 'quote':
                    if (!msg.payload.quotePost || !msg.payload.quotePost.uri) {
                        throw new Error("For 'quote' type, quotePost object with uri is required.");
                    }
                    post.embed = {
                        $type: 'app.bsky.embed.record',
                        record: { 
                            uri: msg.payload.quotePost.uri, 
                            cid: msg.payload.quotePost.cid || '' 
                        }
                    };
                    break;

                case 'repost':
                case 'like':
                    if (!msg.payload.targetUri) {
                        throw new Error(`For '${post.type}' type, targetUri is required.`);
                    }
                    post.targetUri = msg.payload.targetUri;
                    post.targetCid = msg.payload.targetCid;
                    break;

                case 'delete':
                case 'unlike':
                case 'unrepost':
                    if (!msg.payload.targetUri) {
                        throw new Error(`For '${post.type}' type, targetUri is required.`);
                    }
                    post.targetUri = msg.payload.targetUri;
                    post.targetCid = msg.payload.targetCid;
                    break;

                case 'post':
                default:
                    // Simple post, no additional fields needed
                    break;
            }

            return post;
        }

        throw new Error('Invalid payload format. Expected string or object with text and optional type/date.');
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

                // Set up input handler with comprehensive error handling
                // Set up input handler with comprehensive error handling
                node.on('input', async function(msg) {
                    // Initial validation
                    if (!msg || typeof msg !== 'object') {
                        node.error('Invalid message format');
                        node.status({ fill: 'red', shape: 'ring', text: 'error' });
                        return;
                    }

                    try {
                        // Handle different payload formats
                        let payload;
                        if (typeof msg.payload === 'string' || typeof msg.payload === 'number' || typeof msg.payload === 'boolean') {
                            payload = { text: String(msg.payload) };
                        } else if (typeof msg.payload === 'object' && msg.payload !== null) {
                            payload = { ...msg.payload };
                        } else {
                            throw new Error('Invalid payload format. Expected string or object');
                        }

                        // Validate required fields
                        if (!payload.text && !payload.images) {
                            throw new Error('Either text or images must be provided');
                        }

                        // Update status
                        node.status({ fill: 'blue', shape: 'dot', text: 'Processing...' });

                        // Format the post data
                        const postData = await formatPost(bot.agent, { payload });
                        let postPromise;

                        // Process the post based on type
                        switch (postData.type) {
                            case 'post':
                                postPromise = bot.agent.post(postData);
                                break;
                                
                            case 'reply':
                                postPromise = bot.agent.post({
                                    ...postData,
                                    reply: postData.reply
                                });
                                break;

                            case 'quote':
                                postPromise = bot.agent.post({
                                    text: postData.text,
                                    embed: postData.embed,
                                    createdAt: postData.createdAt
                                });
                                break;

                            case 'repost':
                                if (!postData.targetUri) {
                                    throw new Error('targetUri is required for repost');
                                }
                                postPromise = bot.agent.repost(postData.targetUri, postData.targetCid);
                                break;

                            case 'like':
                                if (!postData.targetUri) {
                                    throw new Error('targetUri is required for like');
                                }
                                postPromise = bot.agent.like(postData.targetUri, postData.targetCid);
                                break;

                            case 'delete':
                                if (!postData.targetUri) {
                                    throw new Error('targetUri is required for delete');
                                }
                                postPromise = bot.agent.deletePost(postData.targetUri, postData.targetCid);
                                break;

                            case 'unlike':
                                if (!postData.targetUri) {
                                    throw new Error('targetUri is required for unlike');
                                }
                                postPromise = bot.agent.api.com.atproto.repo.deleteRecord({
                                    repo: bot.agent.session.did,
                                    collection: 'app.bsky.feed.like',
                                    rkey: postData.targetUri.split('/').pop()
                                });
                                break;

                            case 'unrepost':
                                if (!postData.targetUri) {
                                    throw new Error('targetUri is required for unrepost');
                                }
                                postPromise = bot.agent.api.com.atproto.repo.deleteRecord({
                                    repo: bot.agent.session.did,
                                    collection: 'app.bsky.feed.repost',
                                    rkey: postData.targetUri.split('/').pop()
                                });
                                break;

                            default:
                                throw new Error(`Unsupported post type: ${postData.type}`);
                        }

                        try {
                            // Execute the post and handle the response
                            const result = await postPromise;
                            node.status({ 
                                fill: 'green', 
                                shape: 'dot', 
                                text: postData.type || 'success' 
                            });
                            node.send({ 
                                payload: { 
                                    status: 'success', 
                                    type: postData.type || 'post',
                                    result: result
                                } 
                            });
                        } catch (err) {
                            const errorMessage = err.message || 'Unknown error occurred';
                            node.error(`Error with Bluesky ${postData.type || 'post'}: ${errorMessage}`);
                            node.status({ 
                                fill: 'red', 
                                shape: 'ring', 
                                text: 'error' 
                            });
                            node.send({ 
                                payload: { 
                                    status: 'error',
                                    type: postData.type || 'post',
                                    error: errorMessage,
                                    _error: errorMessage,
                                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                                } 
                            });
                        }
                    } catch (err) {
                        const errorMessage = err.message || 'Unknown error occurred';
                        node.error(`Error processing post: ${errorMessage}`);
                        node.status({ 
                            fill: 'red', 
                            shape: 'ring', 
                            text: 'error' 
                        });
                        node.send({ 
                            payload: { 
                                status: 'error',
                                error: errorMessage,
                                _error: errorMessage
                            } 
                        });
                    }
                });

                // Clean up on node removal
                // Cleanup function for node removal
                const cleanup = function(done) {
                    if (bot && typeof bot.close === 'function') {
                        return bot.close()
                            .then(() => {
                                node.status({});
                                if (done) done();
                                return Promise.resolve();
                            })
                            .catch(closeErr => {
                                node.error('Error during cleanup: ' + closeErr.message);
                                node.status({});
                                if (done) done();
                                return Promise.reject(closeErr);
                            });
                    }
                    node.status({});
                    if (done) done();
                    return Promise.resolve();
                };

                // Set up close handler
                node.on('close', cleanup);
            })
            .catch((err) => {
                const errorMessage = err.message || 'Unknown error during initialization';
                const statusMessage = errorMessage.length > 20 ? 'init error' : errorMessage;
                
                node.error('Failed to initialize Bluesky agent: ' + errorMessage);
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: statusMessage
                });
                
                // Store error for later reference
                node.initializationError = errorMessage;
                
                // Set up periodic retry
                if (!node.retryInterval) {
                    node.retryCount = 0;
                    node.retryInterval = setInterval(() => {
                        node.retryCount++;
                        if (node.retryCount <= 5) { // Max 5 retries
                            node.status({
                                fill: 'yellow',
                                shape: 'dot',
                                text: `Retrying (${node.retryCount}/5)...`
                            });
                            // Re-initialize the node
                            initializeBlueskyAgent();
                        } else {
                            clearInterval(node.retryInterval);
                            node.retryInterval = null;
                            node.status({
                                fill: 'red',
                                shape: 'ring',
                                text: 'init failed - check config'
                            });
                        }
                    }, 10000); // Retry every 10 seconds
                }
            });
            
            // Initialize function that can be called on retry
            function initializeBlueskyAgent() {
                blueskyService.get(config.credentials.handle, config.credentials.appkey)
                    .then(agent => {
                        clearInterval(node.retryInterval);
                        node.retryInterval = null;
                        node.retryCount = 0;
                        delete node.initializationError;
                        
                        // Set up the agent and event handlers...
                        // [Previous initialization code would go here]
                        
                        node.status({ fill: 'green', shape: 'dot', text: 'ready' });
                    })
                    .catch(retryErr => {
                        node.error('Retry failed: ' + retryErr.message);
                        // The outer catch will handle the retry logic
                    });
            }
    }

    RED.nodes.registerType("bluesky-post", BlueskyPostNode);
}