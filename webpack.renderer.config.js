// webpack.renderer.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-renderer',
    devtool: isProduction ? false : 'source-map',
    entry: {
        index: './src/renderer/js/index-main.js',
        settings: './src/renderer/js/settings-main.js',
        about: './src/renderer/js/about-main.js',
    },
    output: {
        path: path.resolve(__dirname, 'dist/out/renderer'),
        filename: 'js/[name].bundle.js',
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
            {
                // This rule handles the compiled Tailwind CSS and Font Awesome CSS
                test: /\.css$/,
                use: [MiniCssExtractPlugin.loader, 'css-loader'],
            },
        ],
    },

    plugins: [
        // --- Create a new HtmlWebpackPlugin for EACH of the pages ---
        new HtmlWebpackPlugin({
            template: './src/renderer/index.html',  // Path to the source HTML
            filename: 'index.html',                 // Name of the output HTML in 'dist/out/renderer/'
            chunks: ['index'],                      // IMPORTANT: Inject only the 'index' JavaScript bundle
        }),
        new HtmlWebpackPlugin({
            template: './src/renderer/settings.html',
            filename: 'settings.html',
            chunks: ['settings'],
        }),
        new HtmlWebpackPlugin({
            template: './src/renderer/about.html',
            filename: 'about.html',
            chunks: ['about'],
        }),

        new MiniCssExtractPlugin({
            filename: 'css/[name].styles.css',
        }),

        isProduction && new WebpackObfuscator({
            compact: true,
            selfDefending: true,
            stringArray: true,
            rotateStringArray: true,
        }, []),
    ].filter(Boolean),
};