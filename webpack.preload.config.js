// webpack.preload.config.js
const path = require('path');

const nodeExternals = require('webpack-node-externals');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-preload',
    devtool: isProduction ? false : 'source-map',
    entry: { preload: './src/preload/preload.js' },
    externals: [nodeExternals()],
    output: {
        path: path.resolve(__dirname, 'dist/out/preload'),
        filename: '[name].js',
    },

    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },

    node: {
        __dirname: false,
        __filename: false,
    },
};