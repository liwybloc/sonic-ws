const path = require('path');

module.exports = {
  entry: './html/client/browser/ClientBrowser.js',
  output: {
    filename: 'SonicWS_bundle.js',
    path: path.resolve(__dirname, 'bundled'),
  },
  resolve: {
    extensions: ['.js'],
  },
  module: {
    rules: [
    ],
  },
  mode: 'production',
};
