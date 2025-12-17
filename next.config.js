/** @type {import('next').NextConfig} */
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const basePath =
  rawBasePath && rawBasePath !== '/'
    ? rawBasePath.startsWith('/')
      ? rawBasePath.replace(/\/$/, '')
      : `/${rawBasePath.replace(/\/$/, '')}`
    : '';

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['@xmtp/user-preferences-bindings-wasm'],
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

    return config;
  },
};

module.exports = nextConfig;
