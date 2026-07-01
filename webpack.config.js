const path = require('path');
const webpack = require('webpack');

const LICENSE = `/*!
 * Copyright (c) 2026 Lily (liwybloc)
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 * See LICENSE for personal, non-commercial license terms.
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
