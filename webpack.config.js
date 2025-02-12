const { resolve, dirname, basename } = require( 'path' );

const RtlCssPlugin = require( 'rtlcss-webpack-plugin' );
const MiniCSSExtractPlugin = require( 'mini-css-extract-plugin' );
const { WebWorkerPlugin } = require( '@shopify/web-worker/webpack' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const { hasBabelConfig, hasArgInCLI } = require( '@wordpress/scripts/utils' );

const isProduction = process.env.NODE_ENV === 'production';
const hasReactFastRefresh = hasArgInCLI( '--hot' ) && ! isProduction;

module.exports = {
	...defaultConfig,
	entry: {
		'media-experiments': resolve(
			__dirname,
			'packages/edit-post/src/index.ts'
		),
	},
	output: {
		filename: '[name].js',
		path: resolve( __dirname, 'build' ),
		globalObject: 'self', // This is the default, but required for @shopify/web-worker.
	},
	resolve: {
		extensions: [ '.jsx', '.ts', '.tsx', '...' ],
		fallback: {
			crypto: false,
			path: false,
			util: false,
			zlib: false,
			assert: false,
			stream: false,
			fs: false,
		},
	},
	module: {
		rules: [
			{
				test: /\.([jt])sx?$/,
				exclude: /node_modules/,
				use: [
					{
						loader: require.resolve( 'babel-loader' ),
						options: {
							// Babel uses a directory within local node_modules
							// by default. Use the environment variable option
							// to enable more persistent caching.
							cacheDirectory:
								process.env.BABEL_CACHE_DIRECTORY || true,

							// Provide a fallback configuration if there's not
							// one explicitly available in the project.
							...( ! hasBabelConfig() && {
								babelrc: false,
								configFile: false,
								presets: [
									require.resolve(
										'@wordpress/babel-preset-default'
									),
								],
								plugins: [
									require.resolve(
										'@shopify/web-worker/babel'
									),
									hasReactFastRefresh &&
										require.resolve(
											'react-refresh/babel'
										),
								].filter( Boolean ),
							} ),
						},
					},
				],
			},
			...defaultConfig.module.rules.slice( 1 ),
		],
	},
	plugins: [
		...defaultConfig.plugins.filter(
			( plugin ) => ! ( plugin instanceof MiniCSSExtractPlugin )
		),
		new WebWorkerPlugin(),
		new MiniCSSExtractPlugin( {
			filename: '[name].css',
		} ),
		new RtlCssPlugin( {
			filename: `../build/[name]-rtl.css`,
		} ),
	],
	optimization: {
		...defaultConfig.optimization,
		splitChunks: {
			...defaultConfig.optimization.splitChunks,
			cacheGroups: {
				editor: {
					type: 'css/mini-extract',
					test: /[\\/]styles\.css$/,
					chunks: 'all',
					enforce: true,
					name( _, chunks, cacheGroupKey ) {
						const chunkName = chunks[ 0 ].name;
						return `${ dirname( chunkName ) }/${ basename(
							chunkName
						) }-${ cacheGroupKey }`;
					},
				},
				blocks: {
					type: 'css/mini-extract',
					test: /[\\/]blocks\.css$/,
					chunks: 'all',
					enforce: true,
					name( _, chunks, cacheGroupKey ) {
						const chunkName = chunks[ 0 ].name;
						return `${ dirname( chunkName ) }/${ basename(
							chunkName
						) }-${ cacheGroupKey }`;
					},
				},
				default: false,
			},
		},
	},
};
