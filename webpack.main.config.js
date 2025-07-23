// webpack.main.config.js
const path = require('path');

const { BytenodeWebpackPlugin } = require('@herberttn/bytenode-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const WebpackObfuscator = require('webpack-obfuscator');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-main',
    devtool: isProduction ? false : 'source-map',
    entry: { main: './src/main/main.js' },
    externals: [nodeExternals()],
    output: {
        path: path.resolve(__dirname, 'dist/out/main'),
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

    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'package.json', to: path.resolve(__dirname, 'dist/out') },
                {
                    from: path.resolve(__dirname, 'src/assets'),
                    to: path.resolve(__dirname, 'dist/out/assets'),
                },
                {
                    from: path.resolve(__dirname, 'src/assets_export'),
                    to: path.resolve(__dirname, 'dist/out/assets_export'),
                },
                {
                    from: path.resolve(__dirname, 'src/locale'),
                    to: path.resolve(__dirname, 'dist/out/locale'),
                }
            ]
        }),

        isProduction && new WebpackObfuscator({
            stringArray: true,
            stringArrayThreshold: 1,
            stringArrayEncoding: ['rc4'],
            rotateStringArray: true,
            selfDefending: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
        }, []),

        isProduction && new BytenodeWebpackPlugin({
            compileForElectron: true,
        }),
    ].filter(Boolean), // Filters out falsy values (like 'false' when not in production)

    node: {
        __dirname: false, // Important for paths in Electron main process
        __filename: false,
    },
};