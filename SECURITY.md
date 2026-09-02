<div align="center">

# Security

**No server and no account. Your data makes no network call : the only remote
requests the page makes are for the Material typeface and icon set on Google
Fonts, which carry nothing about your work. That removes most of what a security
policy usually covers, and creates a different set of things worth stating.**

</div>

## What is protected, and how

Credentials are encrypted. A value you seal is encrypted with AES-GCM 256 under
a key derived by PBKDF2-SHA256 at 600 000 iterations from a passphrase that is
never stored. Sealed values live outside the task record, in a separate store,
so they cannot travel inside a shared link or an export. That is a structural
guarantee rather than a careful one : there is no code path that copies them into
a log, because they are not in the log.

Shared links can be sealed. A protected link uses the same primitives. Until the
passphrase is entered, nothing about the log can be read, not even its title. A
sealed link left in a chat is a block of ciphertext.

The page cannot reach any other origin. A strict content security policy starts
from `default-src 'none'` and opens only what this origin serves. The single
inline script is allowed by its hash, never by `unsafe-inline`. Framing, form
submission and `<base>` rewriting are refused outright. The policy is verified
against the deployed site on every probe run.

Every rendered value is escaped. Text written by an agent reaches the DOM
through one escaping function, and agent-authored content is marked
`untrustedContentHint` in the tool annotations so the model treats it as data.

## What is not protected

> [!CAUTION]
> The four points below are the ones people get wrong about a product with no
> server. None of them is a bug; all of them are consequences.

Your logs are not encrypted at rest. IndexedDB holds them in the clear. Anyone
with access to your browser profile can read them. Only credentials and sealed
links are encrypted; claiming otherwise would be false.

An unsealed link is a bearer capability. The log rides in the URL fragment,
which browsers never transmit (no server sees it), but whoever holds the link
holds the log. The page says so before you copy one.

A sealed link cannot tell who opens it. A passphrase proves knowledge of a
secret, not identity. Checking an identity would need a server this product does
not have, and the interface says this rather than implying more.

There is no recovery. Clearing the site's data deletes everything, because no
copy exists on a server. Export before you clear.

## Reporting a vulnerability

> [!IMPORTANT]
> Use GitHub's private advisory, not a public issue, for anything that would
> expose someone's data before it is fixed.

Open a private security advisory through GitHub's Report a vulnerability button
on this repository. Please do not open a public issue for anything that would
expose someone's data before it is fixed.

There is no bug bounty, and no server to attack. But a flaw in the vault, in the
sealing of links, in the escaping of agent content, or in the content security
policy is worth reporting, and will be answered.

## Scope

The measured state of the deployed site is checked by `npm run sonde`, which
asks the live origin rather than the source : headers, policy, origin trial
token, MIME types, caching, redirects and routing. Its failures are real; its
notes are things observed and deliberately not fixed, each with the reason.
