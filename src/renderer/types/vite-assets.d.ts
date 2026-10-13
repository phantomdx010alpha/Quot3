// Phase 33 - `?url` asset imports (Vite). Declared narrowly instead of pulling in all of vite/client.
declare module '*?url' {
  const url: string
  export default url
}
