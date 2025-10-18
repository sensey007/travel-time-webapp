export default {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          // Target older browsers including STB devices
          browsers: [
            'Chrome >= 49',
            'Firefox >= 45', 
            'Safari >= 9',
            'Edge >= 12',
            'ie >= 11'
          ]
        },
        // Force all transforms to ensure maximum compatibility
        forceAllTransforms: true,
        // Don't add polyfills automatically (we'll handle them manually if needed)
        useBuiltIns: false,
        // Keep modules as ES modules for better tree shaking
        modules: false
      }
    ]
  ],
  plugins: [
    // Explicitly include transforms for modern syntax
    '@babel/plugin-transform-optional-chaining',
    '@babel/plugin-transform-nullish-coalescing-operator'
  ]
};
