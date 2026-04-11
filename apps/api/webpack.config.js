module.exports = function (options) {
  return {
    ...options,
    externals: [
      function ({ request }, callback) {
        // Bundle workspace packages instead of leaving them external
        if (request && request.startsWith('@registry-vault/')) {
          return callback();
        }
        // Externalize everything else in node_modules
        if (request && /^[^./]/.test(request)) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      },
    ],
  };
};
