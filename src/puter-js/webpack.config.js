const path = require('path');
const webpack = require('webpack');

console.log('ENV CHECK!!!', process.env.PUTER_ORIGIN, process.env.PUTER_API_ORIGIN);

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'puter.js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: [
    new webpack.DefinePlugin({
      'globalThis.PUTER_ORIGIN': JSON.stringify(process.env.PUTER_ORIGIN || 'https://puter.com'),
      'globalThis.PUTER_API_ORIGIN': JSON.stringify(process.env.PUTER_API_ORIGIN || 'https://api.puter.com'),
    }),
  ],
};
