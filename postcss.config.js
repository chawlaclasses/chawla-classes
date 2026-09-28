// postcss.config.js
module.exports = {
    plugins: {
        'postcss-import': {},
        'postcss-preset-env': {
            stage: 3,
            features: {
                'nesting-rules': true,
                'custom-properties': true,
                'custom-media': true
            }
        },
        'autoprefixer': {
            flexbox: 'no-2009'
        },
        'postcss-reporter': {
            clearReportedMessages: true
        },
        ...(process.env.NODE_ENV === 'production' && {
            'cssnano': {
                preset: ['default', {
                    discardComments: {
                        removeAll: true
                    }
                }]
            }
        })
    }
};