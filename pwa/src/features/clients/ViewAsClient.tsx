import { useParams } from 'react-router'
import { Section } from '../../components/ui.tsx'
import { useTitle } from '../../hooks/env.ts'
import { Banner, ButtonLink } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { HomeView } from '../portfolio/Home.tsx'
import { useClients } from './clients.ts'

/**
 * A client's Home as they see it (plan, section 7: "view as client"), so staff and the client talk about the same
 * screen. It shows what staff read for that client's accounts; the client's own sign-in sees the same numbers.
 */
export default function ViewAsClient() {
  const { id } = useParams()
  const clients = useClients()
  const client = clients.data?.parsed.ok ? clients.data.parsed.value.find((c) => String(c.id) === id) : undefined
  useTitle(client ? `${client.name} as client` : 'View as client')
  return (
    <Section>
      <div className="k-demo k-narrow">
        <h1 className="vh">{client ? `${client.name}’s Home` : 'A client’s Home'}</h1>
        <ClientRead query={clients} what="clients">
          {() =>
            client ? (
              <>
                <Banner tone="info" title={`You are seeing what ${client.name} sees`} action={<ButtonLink to={`/clients/${client.id}`}>Back to the client</ButtonLink>}>
                  Their Home, on their phone. Nothing here changes anything.
                </Banner>
                <HomeView only={client.accounts} preview />
              </>
            ) : (
              <Banner tone="warn" title={`No client ${id ?? ''}`} action={<ButtonLink to="/clients">All clients</ButtonLink>} />
            )
          }
        </ClientRead>
      </div>
    </Section>
  )
}
