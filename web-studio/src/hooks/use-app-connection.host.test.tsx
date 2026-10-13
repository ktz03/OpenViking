// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { AppConnectionProvider, useAppConnection } from './use-app-connection'

const { health } = vi.hoisted(() => ({ health: vi.fn() }))
vi.mock('./use-server-mode', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchServerHealth: health,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => '/',
}))
afterEach(() => {
  cleanup()
  localStorage.removeItem('ov_console_connection')
  window.history.replaceState(null, '', '/')
})

it('discovers the Studio gateway origin before using a stale saved Base URL or key', async () => {
  window.history.replaceState(null, '', '/studio/')
  localStorage.setItem(
    'ov_console_connection',
    JSON.stringify({
      baseUrl: 'https://previous-ov.example',
      adminApiKey: 'previous-root-key',
      apiKey: 'previous-user-key',
      accountId: 'old',
      userId: 'old',
    }),
  )
  health.mockResolvedValue({
    service: 'openviking-gateway',
    auth_mode: 'api_key',
    openviking_url: 'https://ov.example',
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function State() {
    const { connection, isGatewayHost, serverMode } = useAppConnection()
    return (
      <output>
        {JSON.stringify({ connection, isGatewayHost, serverMode })}
      </output>
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <AppConnectionProvider>
        <State />
      </AppConnectionProvider>
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      '"serverMode":"api_key"',
    ),
  )
  const state = JSON.parse(screen.getByRole('status').textContent || '{}')
  expect(state.isGatewayHost).toBe(true)
  expect(state.connection).toEqual({
    baseUrl: window.location.origin,
    accountId: 'default',
    userId: 'default',
    apiKey: '',
    adminApiKey: '',
  })
  expect(
    health.mock.calls.every(
      ([baseUrl, headers]) =>
        baseUrl === window.location.origin && !headers?.['X-API-Key'],
    ),
  ).toBe(true)
  queryClient.clear()
})
