// Only the latest read may update the UI. Writes deliberately are not retried.
export function createLatestRequest() {
  let controller
  return {
    start() {
      controller?.abort()
      controller = new AbortController()
      return controller
    },
    cancel() { controller?.abort() },
  }
}
