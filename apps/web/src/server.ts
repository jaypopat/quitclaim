import index from "./index.html";

const server = Bun.serve({
  routes: { "/*": index },
  // TanStack router-core and its load-client module import each other, and Bun's HMR module
  // format leaves one of them null at load. Without HMR the bundle links normally.
  development: { hmr: false, console: true },
});
console.log(`web on ${server.url}`);
