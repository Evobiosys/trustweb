/** Wave 12 (src/native_app.ts): inside the iPhone app, root-relative requests go to the server, nothing else is touched. */
import { serverUrl } from '../../src/native_app.ts'

describe('native_app', () => {
  it('rewrites root-relative request URLs for the server and leaves every other URL alone', () => {
    const server = 'https://app.trustweb.one'
    expect(serverUrl('/backup/health', server)).toBe('https://app.trustweb.one/backup/health')
    expect(serverUrl('/org/hit', server)).toBe('https://app.trustweb.one/org/hit')
    expect(serverUrl('https://api.github.com/x', server)).toBe('https://api.github.com/x')
    expect(serverUrl('//evil.example/x', server)).toBe('//evil.example/x')
    expect(serverUrl('icons/icon-192.png', server)).toBe('icons/icon-192.png')
  })
})
