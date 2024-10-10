/** @type {import('next').NextConfig} */
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

const nextConfig = {
  webpack: (config, { isServer }) => {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };

    config.output.webassemblyModuleFilename = (isServer ? '../' : '') + 'static/wasm/[modulehash].wasm';

    const wasmFile = 'user_preferences_bindings_wasm_bg.wasm';
    const wasmPath = path.join(__dirname, `node_modules/@xmtp/user-preferences-bindings-wasm/dist/web/${wasmFile}`);

    config.plugins.push(
      new CopyPlugin({
        patterns: [
          {
            from: wasmPath,
            to: path.join(__dirname, `.next/server/app/${wasmFile}`),
          },
          {
            from: wasmPath,
            to: path.join(__dirname, `.next/static/wasm/${wasmFile}`),
          },
        ],
      })
    );

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
    };

    // Modify the WebAssembly loader configuration
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'javascript/auto',
      use: [
        {
          loader: 'wasm-loader',
          options: {
            name: 'static/wasm/[name].[hash].[ext]',
          },
        },
      ],
    });

    // Remove the custom 'wbg' module initialization
    // as it might be causing conflicts with the WebAssembly loader

    return config;
  },
};

module.exports = nextConfig;
