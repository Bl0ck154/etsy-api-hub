# Etsy API access for sellers and developers

Etsy Seller MCP Hub is self-hosted code that uses the Etsy Open API v3. Installing it does not give you Etsy permissions or authorize other sellers' shops.

## Which Etsy app type do I need?

| App type | Intended use | Limit |
| --- | --- | --- |
| Seller App (new July 2026) | Your own shop's data, workflows and automation | Can authenticate only the seller's registered shop |
| Existing approved Personal Key | Continue existing authorized Etsy use | Keep current approval and scopes; no forced new Seller App |
| Personal App | Develop an application for beyond-one-shop scenarios, at limited scale | Subject to Etsy review and applicable limits |
| Commercial Access | Connect shops of other sellers at broader scale | Requires approved Personal App and commercial approval |

Etsy's [Seller API Access announcement of July 13, 2026](https://github.com/etsy/open-api/discussions/1647) specifically states that current Personal Key holders are **not eligible** for a new Seller App, because existing keys provide comparable access. Do not deactivate a working Personal Key to set up this MCP.

## Existing API keys and OAuth

An old approved **Open API v3** application can work with this package. Use its keystring and shared secret, and OAuth 2.0 consent with the required scopes for private shop data and writes. Old OAuth 1.0 access tokens cannot be passed directly to v3: reauthorize or follow Etsy's official token migration path.

Confirm your app's **approved status and allowed access** in [Etsy Developer Portal](https://www.etsy.com/developers/). Never share your app's secret or refresh tokens.

## Distributing self-hosted code

Each person who installs this repository needs their own approved and authorized Etsy app. Publishing this library does not turn your private Seller App into a service that can connect to other sellers. The current remote MCP OAuth path is owner-only and does not isolate multiple independent seller accounts.

## Official references

- [Etsy Open API v3 access types](https://developer.etsy.com/documentation/)
- [Etsy's July 2026 Seller App announcement](https://github.com/etsy/open-api/discussions/1647)
- [Etsy Open API v3 authentication](https://developer.etsy.com/documentation/essentials/authentication/)
- [Etsy API Terms](https://www.etsy.com/legal/api/)

> The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy.
