var subscribe = require('./messageContants').subscribe;

module.exports = function (client, options) {
  client.connect(options.port, options.server, () => {
    client.write(subscribe);
    if (options.onConnect) {
      options.onConnect();
    }
  });
};
