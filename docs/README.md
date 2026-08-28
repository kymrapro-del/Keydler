# Documentation

Everything here was written while building the thing it describes, and none of
it is marketing. Where a number appears, it was measured; where something was
not verified, the text says so.

Most of it is in French — the language the work was done in. The product, its
interface and the [README](../README.md) are in English.

## Start here

| Document                           | What it holds                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [verification.md](verification.md) | The honest journal. Every check run, in order, including the ones that failed and the mistakes made while probing |
| [echelle.md](echelle.md)           | What happens at scale, and what it costs — measured on real logs, not estimated                                   |
| [concours.md](concours.md)         | What the contest research actually established, and what it did not                                               |

## The product

| Document                             | What it holds                                                  |
| ------------------------------------ | -------------------------------------------------------------- |
| [interface.md](interface.md)         | Every panel on the page, and the reason it exists              |
| [deploiement.md](deploiement.md)     | Putting it on a host, enabling WebMCP, pointing an agent at it |
| [demonstration.md](demonstration.md) | The demonstration script                                       |

## Audits

Two adversarial passes over the product, each looking for what the tests
could not see.

- [audits/premier.md](audits/premier.md)
- [audits/second.md](audits/second.md)

## Protocols

How to reproduce the work rather than take its word.

| Protocol                                                   | For                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [protocoles/webmcp-manuel.md](protocoles/webmcp-manuel.md) | Driving the thirteen tools by hand in a WebMCP browser            |
| [protocoles/mesure.md](protocoles/mesure.md)               | Running the measurement campaign the numbers come from            |
| [protocoles/reprise.md](protocoles/reprise.md)             | Handing the task to a fresh agent, which is the product's own use |

## Measurements

- [mesures/taches.md](mesures/taches.md) — the tasks the campaign runs
- [mesures/resultats.md](mesures/resultats.md) — what came out of them

## Elsewhere

- [plan.md](plan.md) — what was planned, and what changed on contact with the work
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — conventions this repository holds to
- [../SECURITY.md](../SECURITY.md) — what is protected, what is not, and how to report a flaw
