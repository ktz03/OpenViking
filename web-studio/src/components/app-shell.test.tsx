// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ConnectionScopedRouteContent,
  shouldShowGatewayNavigation,
} from './app-shell'

afterEach(cleanup)

describe('ConnectionScopedRouteContent', () => {
  it('does not mount route content while the server mode is unresolved', () => {
    render(
      <ConnectionScopedRouteContent serverMode="checking">
        <span data-testid="identity-scoped-route" />
      </ConnectionScopedRouteContent>,
    )

    expect(screen.queryByTestId('identity-scoped-route')).toBeNull()
  })

  it.each(['api_key', 'trusted', 'dev', 'oidc', 'ldap', 'offline'] as const)(
    'mounts route content after resolving %s mode',
    (serverMode) => {
      render(
        <ConnectionScopedRouteContent serverMode={serverMode}>
          <span data-testid="identity-scoped-route" />
        </ConnectionScopedRouteContent>,
      )

      expect(screen.getByTestId('identity-scoped-route')).toBeTruthy()
    },
  )
})

describe('gateway navigation', () => {
  it.each([
    ['dev', true, true],
    ['api_key', true, true],
    ['trusted', true, true],
    ['api_key', false, false],
    ['offline', true, false],
    ['checking', true, false],
  ] as const)('%s allowed %s: %s', (serverMode, allowed, visible) => {
    expect(
      shouldShowGatewayNavigation({
        isGatewayHost: false,
        serverMode,
        allowed,
      }),
    ).toBe(visible)
  })

  it('always shows the entry on a standalone gateway', () => {
    expect(
      shouldShowGatewayNavigation({
        isGatewayHost: true,
        serverMode: 'offline',
        allowed: false,
      }),
    ).toBe(true)
  })
})
