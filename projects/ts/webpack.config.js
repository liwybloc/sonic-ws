const path = require('path');
const webpack = require('webpack');

const LICENSE = `/*!
 * Copyright (c) 2026 Lily (liwybloc)
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 * See LICENSE for personal, non-commercial license terms.
 */\n;\n`;

module.exports = {
  entry: './dist/ws/client/browser/ClientBrowser.js',
  output: {
    filename: 'bundle.js',
    webassemblyModuleFilename: 'bundle.wasm',
    path: path.resolve(__dirname, '../../bundled'),
    clean: true,
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
  experiments: {
    asyncWebAssembly: true,
  },
  optimization: {
    minimize: true,
    minimizer: [
      new (require('terser-webpack-plugin'))({
        extractComments: false,
      }),
    ],
  },
};
