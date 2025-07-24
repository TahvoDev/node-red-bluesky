module.exports = function(RED) {
    function BlueskyPostNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;
        node.on('input', function(msg) {

            node.send('test');
        });
    }
    RED.nodes.registerType("bluesky-post",BlueskyPostNode);
}
