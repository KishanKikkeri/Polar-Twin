// Tiny fetch mock for the node:test suite (no test-framework dependency).
export function mockFetch(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  fn.calls = calls
  return fn
}

export const jsonResponse = (body, { status = 200, statusText = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => body,
})
