const path = require('path');
const webpack = require('webpack');

const LICENSE = `/*!
 * SonicWS
 * (c) 2025 Lily (liwybloc)
 * Released under the Apache-2.0 License
 * https://www.apache.org/licenses/LICENSE-2.0
 */\n;\n`;

module.exports = {
  entry: './html/ws/client/browser/ClientBrowser.js',
  output: {
    filename: 'SonicWS_bundle.js',
    path: path.resolve(__dirname, 'bundled'),
  },
  resolve: {
    extensions: ['.js'],
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: LICENSE,
      raw: true,
      entryOnly: true,
    }),
  ],
  module: {
    rules: [
    ],
  },
  mode: 'production',
  optimization: {
    minimize: true,
    minimizer: [
      new (require('terser-webpack-plugin'))({
        extractComments: false,
      }),
    ],
  },
};
