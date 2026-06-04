const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

const ignoredOptionalTransportPackages = [
  '@grpc/grpc-js',
  '@grpc/proto-loader',
  '@nestjs/websockets/socket-module',
  'amqp-connection-manager',
  'amqplib',
  'kafkajs',
  'mqtt',
  'nats',
];

module.exports = {
  resolve: {
    alias: Object.fromEntries(
      ignoredOptionalTransportPackages.map((packageName) => [packageName, false]),
    ),
  },
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ["./src/assets"],
      externalDependencies: 'all',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    })
  ],
};
