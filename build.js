const esbuild = require('esbuild');

// Build configuration
const buildConfig = {
  entryPoints: {
    'background-bundle': './src/background.js',
    'popover-bundle': './src/popover.js',
    'auth-bundle': './src/auth.js',
    'content-bundle': './content.js'
  },
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  target: 'chrome90',
  format: 'iife',
  sourcemap: process.env.NODE_ENV !== 'production',
  minify: process.env.NODE_ENV === 'production',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }
};

async function build() {
  try {
    // Build the bundles
    await esbuild.build(buildConfig);
    console.log('✅ Build completed successfully');
    
    // Watch mode
    if (process.argv.includes('--watch')) {
      const ctx = await esbuild.context(buildConfig);
      await ctx.watch();
      console.log('👀 Watching for changes...');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();