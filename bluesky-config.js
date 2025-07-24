module.exports = function(RED) {
    
    function BlueSkyConfigNode(n) {
        RED.nodes.createNode(this,n);

        this.username = n.username;
        this.password = n.password;
    }
    RED.nodes.registerType("bluesky-config",BlueSkyConfigNode);
}