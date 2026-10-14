// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountSwitcher } from './account-switcher'

const { fetchAccounts, fetchUsers, switchAccount, switchIdentity } = vi.hoisted(
  () => ({
    fetchAccounts: vi.fn(),
    fetchUsers: vi.fn(),
    switchAccount: vi.fn(),
    switchIdentity: vi.fn(),
  }),
)
vi.mock('#/lib/admin', () => ({
  fetchAdminAccounts: fetchAccounts,
  fetchAdminUsers: fetchUsers,
  createAdminAccount: vi.fn(),
}))
vi.mock('#/hooks/use-app-connection', () => ({
  useAppConnection: () => ({
    connection: {
      accountId: 'default',
      userId: 'root',
      apiKey: 'root-login-key',
      adminApiKey: '',
      baseUrl: 'http://gateway.test',
    },
    connectionRole: 'root',
    isGatewayHost: true,
    isConnectionRoleLoading: false,
    serverMode: 'api_key',
    switchManagementAccount: switchAccount,
    switchIdentity,
    setGeneratedCredential: vi.fn(),
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(cleanup)
it('root selects an account through the read-only list without requesting user credentials or offering creation', async () => {
  fetchAccounts.mockResolvedValue([
    { accountId: 'default', userCount: 1 },
    { accountId: 'team', userCount: 2 },
  ])
  switchAccount.mockResolvedValue(undefined)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AccountSwitcher />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByText('default'))
  await waitFor(() => expect(screen.getByText('team')).toBeTruthy())
  expect(screen.queryByText('create')).toBeNull()
  expect(fetchAccounts).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: 'root-login-key',
      baseUrl: 'http://gateway.test',
    }),
  )
  fireEvent.click(screen.getByText('team'))
  await waitFor(() => expect(switchAccount).toHaveBeenCalledWith('team'))
  expect(fetchUsers).not.toHaveBeenCalled()
  expect(switchIdentity).not.toHaveBeenCalled()
  client.clear()
})
