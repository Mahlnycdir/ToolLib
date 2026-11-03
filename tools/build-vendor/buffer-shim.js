// isomorphic-git expects Node's Buffer; esbuild injects this polyfill wherever Buffer is used.
export { Buffer } from 'buffer';
