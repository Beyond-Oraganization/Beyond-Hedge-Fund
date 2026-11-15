import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CommandData } from '../../api/bot.ts'
import type { CommandFailure } from '../../api/client.ts'
import { Skeleton } from '../../components/ui.tsx'
import { Banner, Button } from '../../shared/ui/index.ts'

/**
 * A read on a client's screen, in a client's words: a skeleton while it loads, what went wrong and a way to try again,
 * and an older answer kept on screen when a refresh fails. No command lines, no "the bot said".
 */
export function ClientRead<T>({ query, what, children }: { query: UseQueryResult<CommandData<T>, CommandFailure>; what: string; children: (value: T) => ReactNode }) {
  const retry = (
    <Button variant="secondary" icon="refresh" onClick={() => void query.refetch()}>
      Try again
    </Button>
  )
  if (!query.data) {
    if (!query.error) return <Skeleton lines={4} />
    // A server from before the fund's portfolios: "Unknown command 'portfolio'", or to a person, not a command they can run.
    if (/unknown command|is not a command you can run/i.test(query.error.message))
      return (
        <Banner tone="warn" title={`The fund’s server does not show ${what} yet`}>
          It needs an update first. Nothing has changed in your account.
        </Banner>
      )
    return (
      <Banner tone="error" title={`Your ${what} could not be loaded`} action={retry}>
        {query.error.message}
      </Banner>
    )
  }
  const { parsed } = query.data
  return (
    <>
      {query.error ? (
        <Banner tone="warn" title="Showing what this device saw last" action={retry}>
          {query.error.message}
        </Banner>
      ) : null}
      {parsed.ok ? (
        children(parsed.value)
      ) : (
        <Banner tone="error" title={`Your ${what} came in a form this app does not know`}>
          Updating the app may help: reload the page.
        </Banner>
      )}
    </>
  )
}
