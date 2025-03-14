import restart from 'vite-plugin-restart'
import glsl from 'vite-plugin-glsl'

export default {
    root: 'src/',
    publicDir: '../static/',
    base: './',
    server:
    {
        host: true, // Open to local network and display URL
        open: !('SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env) // Open if it's not a CodeSandbox
    },
    build:
    {
        chunkSizeWarningLimit: 1000,
        outDir: '../dist', // Output in the dist/ folder
        emptyOutDir: true, // Empty the folder first
        sourcemap: true, // Add sourcemap
        target: 'esnext', // compatibility only with modern browsers
        manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("react") || id.includes("react-dom")) {
                return "react-vendor";
              }
              if (id.includes("three")) {
                return "three-vendor";
              }
              return "vendor"; // Otras dependencias
            }
          },
    },
    plugins:
    [
        restart({ restart: [ '../static/**', ] }), // Restart server on static file change
        glsl() // Handle shader files
    ]
}