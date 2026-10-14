import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { LoaderCircleIcon, PlugZapIcon, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { cn } from '#/lib/utils'

import {
  deleteUpstream,
  saveUpstream,
  testUpstream,
  toGatewayError,
} from '../-lib/api'
import type { Upstream, UpstreamTestResult } from '../-lib/api'
import { toastGatewayError } from '../-lib/error-toast'
import { gatewayErrorMessage } from '../-lib/localize'
import type { Translate } from '../-lib/localize'
import { useGateway } from '../-lib/use-gateway'
import { toUpstreamInput } from '../-lib/upstream-schema'
import { Notice } from './notice'
import { ExplainedButton } from './explained-button'
import { ToneBadge } from './status-badges'
import type { Tone } from './status-badges'

/** Why the stored upstream cannot be tested, or undefined when it can. */
function testBlockedReason(
  upstream: Pick<Upstream, 'auth_mode' | 'has_api_key'>,
): 'passthrough' | 'noKey' | undefined {
  if (upstream.auth_mode === 'passthrough') return 'passthrough'
  return upstream.has_api_key ? undefined : 'noKey'
}

/** A finished test: the gateway's answer, or the error the call threw. */
type TestOutcome =
  | { result: UpstreamTestResult; error?: undefined }
  | { result?: undefined; error: unknown }

type TestSummary = { tone: Tone; label: string; explanation: string }

/** Badge text and explanation for a finished connection test. */
export function describeTest(t: Translate, outcome: TestOutcome): TestSummary {
  const { result } = outcome
  if (!result) {
    return {
      tone: 'danger',
      label: t('upstreams.test.result.error'),
      explanation: gatewayErrorMessage(t, outcome.error),
    }
  }
  const withUrl = (message: string) =>
    result.url ? `${message} ${result.url}` : message
  if (
    result.reason === 'models_unavailable' ||
    result.status === 404 ||
    result.status === 405 ||
    result.reason === 'rate_limited' ||
    result.status === 429
  ) {
    return {
      tone: 'neutral',
      label: t('upstreams.test.result.unverified', { status: result.status }),
      explanation: withUrl(
        t(
          result.reason === 'rate_limited' || result.status === 429
            ? 'upstreams.test.explain.rateLimited'
            : 'upstreams.test.explain.notFound',
        ),
      ),
    }
  }
  if (result.reason === 'upstream_key_missing') {
    return {
      tone: 'danger',
      label: t('upstreams.credentials.keyMissing'),
      explanation: t('errors.reasons.upstream_key_missing'),
    }
  }
  if (result.status === undefined) {
    return {
      tone: 'danger',
      label: t('upstreams.test.result.unreachable'),
      explanation: withUrl(t('upstreams.test.explain.unreachable')),
    }
  }
  const { status } = result
  if (result.ok && result.reason !== 'upstream_key_rejected') {
    return {
      tone: 'success',
      label: t('upstreams.test.result.ok', { status }),
      explanation: t('upstreams.test.explain.ok'),
    }
  }
  // 404 and 405 were answered above as reachable but unverified.
  const explanation =
    result.reason === 'upstream_key_rejected' ||
    status === 401 ||
    status === 403
      ? t('upstreams.test.explain.auth')
      : t('upstreams.test.explain.status', { status })
  return {
    tone: 'danger',
    label: t('upstreams.test.result.failed', { status }),
    explanation: withUrl(explanation),
  }
}

type UpstreamTestProps = {
  upstream: Upstream
  /** `row`: compact ghost button for the list; `header`: outline button for the editor. */
  variant?: 'row' | 'header'
  /** Extra line for the tooltip, e.g. that only saved settings are tested. */
  note?: string
}

/**
 * Tests the saved upstream and shows the result next to the button: a
 * badge such as "Reachable · 200" with the explanation on hover.
 */
export function UpstreamTest({
  upstream,
  variant = 'row',
  note,
}: UpstreamTestProps) {
  const { t } = useTranslation('gateway')
  const { connection } = useGateway()
  const test = useMutation<UpstreamTestResult, unknown>({
    mutationFn: () => testUpstream(connection, upstream.id),
  })
  const blocked = testBlockedReason(upstream)
  const explanation = blocked
    ? t(`upstreams.test.${blocked}`)
    : [t('upstreams.test.hint'), note].filter(Boolean).join(' ')
  const summary = test.isSuccess
    ? describeTest(t, { result: test.data })
    : test.isError
      ? describeTest(t, { error: test.error })
      : undefined
  const label = t(
    variant === 'row' ? 'upstreams.test.action' : 'upstreams.test.connection',
  )
  // In the list, below `md`, the button shows only its icon and the result
  // only its dot; the text stays for screen readers.
  const compact = variant === 'row' ? 'max-md:sr-only' : undefined

  return (
    <div className="flex items-center gap-2">
      <span aria-live="polite" className="contents">
        {summary && !test.isPending ? (
          <ToneBadge
            tone={summary.tone}
            dot
            title={summary.explanation}
            className="max-w-48"
          >
            <span className={cn('min-w-0 truncate', compact)}>
              {summary.label}
            </span>
          </ToneBadge>
        ) : null}
      </span>
      <ExplainedButton
        type="button"
        variant={variant === 'row' ? 'ghost' : 'outline'}
        size="sm"
        className={variant === 'row' ? 'h-8 px-2 text-xs' : undefined}
        disabled={Boolean(blocked) || test.isPending}
        explanation={explanation}
        onClick={() => test.mutate()}
      >
        {test.isPending ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <PlugZapIcon />
        )}
        <span className={compact}>
          {test.isPending ? t('upstreams.test.running') : label}
        </span>
      </ExplainedButton>
    </div>
  )
}

type DeleteUpstreamButtonProps = {
  /** Known keys that use the upstream; the server confirms conflicts. */
  usedBy: number | undefined
  onClick: () => void
}

/** Header Delete button; the server checks whether keys still use it. */
export function DeleteUpstreamButton({
  usedBy,
  onClick,
}: DeleteUpstreamButtonProps) {
  const { t } = useTranslation('gateway')
  const blocked = Boolean(usedBy)
  return (
    <ExplainedButton
      type="button"
      variant="destructive"
      size="sm"
      explanation={
        blocked ? t('upstreams.delete.blocked', { count: usedBy }) : undefined
      }
      onClick={onClick}
    >
      <Trash2Icon />
      {t('upstreams.delete.action')}
    </ExplainedButton>
  )
}

type DeleteUpstreamDialogProps = {
  /** The upstream to delete; the dialog is open while set. */
  upstream: Upstream | null
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}

/** Confirms and deletes an upstream; a conflict refreshes the key list. */
export function DeleteUpstreamDialog({
  upstream,
  onOpenChange,
  onDeleted,
}: DeleteUpstreamDialogProps) {
  const { t } = useTranslation('gateway')
  const { connection, invalidate } = useGateway()
  const [conflict, setConflict] = React.useState<number | null>(null)
  React.useEffect(() => setConflict(null), [upstream?.id])
  const disable = useMutation({
    mutationFn: (target: Upstream) =>
      saveUpstream(connection, target.id, {
        ...toUpstreamInput(target),
        enabled: false,
      }),
    onSuccess: async () => {
      onOpenChange(false)
      await invalidate('upstreams')
    },
    onError: (error) => toastGatewayError(t, error),
  })
  const remove = useMutation({
    mutationFn: (target: Upstream) => deleteUpstream(connection, target.id),
    onSuccess: async (_result, target) => {
      toast.success(t('upstreams.toast.deleted', { name: target.name }))
      onOpenChange(false)
      onDeleted?.()
      await invalidate('upstreams')
    },
    onError: async (error) => {
      const failure = toGatewayError(error)
      if (failure.reason === 'in_use') {
        setConflict(failure.keyCount ?? 0)
        await invalidate('keys')
      } else toastGatewayError(t, error)
    },
  })
  const pending = remove.isPending || disable.isPending
  return (
    <Dialog
      open={upstream !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('upstreams.delete.title', { name: upstream?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('upstreams.delete.description')}
          </DialogDescription>
        </DialogHeader>
        {conflict !== null ? (
          <Notice tone="warning">
            <p>{t('upstreams.delete.inUse', { count: conflict })}</p>
            {upstream?.enabled ? (
              <p>{t('upstreams.delete.disableHint')}</p>
            ) : null}
            <Link
              to="/gateway/keys"
              className="justify-self-start font-medium underline underline-offset-4"
            >
              {t('actions.viewKeys')}
            </Link>
          </Notice>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          {conflict !== null ? (
            upstream?.enabled ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => disable.mutate(upstream)}
              >
                {t('upstreams.delete.disable')}
              </Button>
            ) : null
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (upstream) remove.mutate(upstream)
              }}
            >
              <Trash2Icon />
              {t('upstreams.delete.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
