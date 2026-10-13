import { Navigate, createFileRoute } from '@tanstack/react-router'

import { useAppConnection } from '#/hooks/use-app-connection'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  const { isGatewayHost } = useAppConnection()
  return <Navigate replace to={isGatewayHost ? '/gateway' : '/home'} />
}
