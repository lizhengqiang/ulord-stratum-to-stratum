const connect = require('./connect');

module.exports = (client, options, error) => {
  const autoReconnectOnError = options.autoReconnectOnError;
  const onError = options.onError;
  if (onError) onError(error);

  if (autoReconnectOnError) {
    connect(client, options);
  } else {
    client.destroy(); // kill client after server's response
  }
};
