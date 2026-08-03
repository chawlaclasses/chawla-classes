// webpack.config.js
"use strict";

const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    entry: {
        app: './public/student/js/app.js',
        dashboard: './public/student/js/components/Dashboard/index.js',
        test: './public/student/js/components/Tests/index.js',
        results: './public/student/js/components/Results/index.js',
        practice: './public/student/js/components/Practice/index.js'
    },
    output: {
        path: path.resolve(__dirname, 'dist/student'),
        filename: isProduction ? 'js/[name].[contenthash].js' : 'js/[name].js',
        chunkFilename: isProduction ? 'js/[name].[contenthash].chunk.js' : 'js/[name].chunk.js',
        publicPath: '/student/',
        clean: true
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {
                                targets: {
                                    browsers: ['last 2 versions', 'not dead', '> 0.2%']
                                },
                                modules: false
                            }]
                        ],
                        plugins: [
                            '@babel/plugin-transform-runtime',
                            '@babel/plugin-syntax-dynamic-import'
                        ]
                    }
                }
            },
            {
                test: /\.css$/,
                use: [
                    isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                    'css-loader',
                    'postcss-loader'
                ]
            },
            {
                test: /\.(png|jpe?g|gif|svg|webp)$/i,
                type: 'asset/resource',
                generator: {
                    filename: 'images/[name].[hash][ext]'
                }
            },
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/i,
                type: 'asset/resource',
                generator: {
                    filename: 'fonts/[name].[hash][ext]'
                }
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin(),
        new webpack.ProgressPlugin(),
        new MiniCssExtractPlugin({
            filename: isProduction ? 'css/[name].[contenthash].css' : 'css/[name].css',
            chunkFilename: isProduction ? 'css/[name].[contenthash].chunk.css' : 'css/[name].chunk.css'
        }),
        new HtmlWebpackPlugin({
            template: './public/student/index.html',
            filename: 'index.html',
            chunks: ['app'],
            inject: true,
            minify: isProduction ? {
                removeComments: true,
                collapseWhitespace: true,
                removeRedundantAttributes: true,
                useShortDoctype: true,
                removeEmptyAttributes: true,
                removeStyleLinkTypeAttributes: true,
                keepClosingSlash: true,
                minifyJS: true,
                minifyCSS: true,
                minifyURLs: true
            } : false
        }),
        new webpack.ProvidePlugin({
            Chart: 'chart.js'
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
            'process.env.API_URL': JSON.stringify(process.env.API_URL || '/api'),
            '__DEV__': !isProduction
        })
    ],
    optimization: {
        minimize: isProduction,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: isProduction,
                        drop_debugger: isProduction
                    },
                    format: {
                        comments: false
                    }
                },
                extractComments: false
            }),
            new CssMinimizerPlugin({
                minimizerOptions: {
                    preset: [
                        'default',
                        {
                            discardComments: { removeAll: true },
                            normalizeWhitespace: true
                        }
                    ]
                }
            })
        ],
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                    priority: 10
                },
                common: {
                    name: 'common',
                    minChunks: 2,
                    chunks: 'all',
                    priority: 5,
                    reuseExistingChunk: true
                },
                charts: {
                    test: /[\\/](chart\.js)[\\/]/,
                    name: 'charts',
                    chunks: 'all',
                    priority: 15
                }
            }
        },
        runtimeChunk: 'single'
    },
    resolve: {
        extensions: ['.js', '.json', '.css'],
        alias: {
            '@': path.resolve(__dirname, 'public/student'),
            '@api': path.resolve(__dirname, 'public/student/js/api'),
            '@services': path.resolve(__dirname, 'public/student/js/services'),
            '@components': path.resolve(__dirname, 'public/student/js/components'),
            '@utils': path.resolve(__dirname, 'public/student/js/utils'),
            '@css': path.resolve(__dirname, 'public/student/css'),
            '@assets': path.resolve(__dirname, 'public/assets')
        }
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'public')
        },
        compress: true,
        port: 3001,
        hot: true,
        historyApiFallback: {
            index: '/student/index.html'
        },
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true
            },
            '/ws': {
                target: 'http://localhost:3000',
                ws: true
            }
        },
        devMiddleware: {
            writeToDisk: true
        }
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    stats: {
        modules: false,
        children: false,
        chunks: false
    }
};