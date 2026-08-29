<div align="center">

# Documentation

**Everything here was written while building the thing it describes.**

</div>

> [!NOTE]
> Where a number appears, it was measured. Where something was not verified, the
> text says so. The repository uses English throughout, including its historical
> build journal and protocols.

## Start here

| Document                              | What it holds                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 📓 [verification.md](verification.md) | The honest journal. Every check run, in order, including the ones that failed and the mistakes made while probing |
| 📈 [scale.md](scale.md)               | What happens at scale, and what it costs (measured on real logs, not estimated)                                   |
| 🏁 [contest.md](contest.md)           | What the contest research actually established, and what it did not                                               |

## The product

| Document                                | What it holds                                                  |
| --------------------------------------- | -------------------------------------------------------------- |
| 🖥️ [interface.md](interface.md)         | Every panel on the page, and the reason it exists              |
| 🚢 [deployment.md](deployment.md)       | Putting it on a host, enabling WebMCP, pointing an agent at it |
| 🎬 [demonstration.md](demonstration.md) | The demonstration script                                       |

## Audits

Two adversarial passes over the product, each looking for what the tests could
not see.

- 🔍 [audits/first.md](audits/first.md)
- 🔍 [audits/second.md](audits/second.md)

## Protocols

How to reproduce the work rather than take its word.

| Protocol                                                 | For                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| [protocols/webmcp-manual.md](protocols/webmcp-manual.md) | Driving the thirteen tools by hand in a WebMCP browser            |
| [protocols/measurement.md](protocols/measurement.md)     | Running the measurement campaign the numbers come from            |
| [protocols/resumption.md](protocols/resumption.md)       | Handing the task to a fresh agent, which is the product's own use |

## Measurements

- [measurements/tasks.md](measurements/tasks.md) : the tasks the campaign runs
- [measurements/results.md](measurements/results.md) : what came out of them

## Elsewhere

- [plan.md](plan.md) : what was planned, and what changed on contact with the work
- [../CONTRIBUTING.md](../CONTRIBUTING.md) : conventions this repository holds to
- [../SECURITY.md](../SECURITY.md) : what is protected, what is not, and how to report a flaw
