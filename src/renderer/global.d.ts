import type { Api } from '../preload/index';

declare module '*.png' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    api: Api;
  }
}

export {};
