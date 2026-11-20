# WindowProof

WindowProof checks archived contest listings against rules or linked application forms. It shows the source links and preserves missing clock times when comparing deadlines. The desk reads two separately hosted archive networks, each after its own consent prompt.

## Run locally

The current build runs locally. Node.js 24 runs the app and tests without installing npm packages. Leave loopback ports 8765, 8766 and 8767 free for the three servers.

```powershell
node build.mjs
node serve.mjs
```

Open [the desk](http://127.0.0.1:8765). Select a case, choose **Compare sources**, and decide whether to allow each source. The comparison works without a model.

| Site | Local address | Files |
| --- | --- | --- |
| Desk | `http://127.0.0.1:8765` | `public/` |
| Listing archive | `http://localhost:8766` | `public/peers/listings/` |
| Rules archive | `http://[::1]:8767` | `public/peers/rules/` |

Stop the local server before running `node --test verify.test.mjs`. The suite starts the three servers and verifies the archived comparisons with actual HTTP JSON reads. A separate test runs the published networks in the reference runtime with scripted model responses to check tool dispatch and peer consent.

## Optional local model

Run an OpenAI-compatible router that supports function tools. The LM Studio example uses Windows PowerShell and an existing Qwen3.5-4B model. If loopback port 1234 already serves LM Studio, leave that server running and load the model there. Stop the desk server before rebuilding and restarting it.

```powershell
lms server start --port 1234 --bind 127.0.0.1
lms load qwen3.5-4b --identifier windowproof-qwen --ttl 600 -c 4096 -y
$env:WINDOWPROOF_ROUTER = 'http://127.0.0.1:8765/local-model/v1'
$env:WINDOWPROOF_LOCAL_MODEL = '1'
node build.mjs
node serve.mjs
```

In **Ask the browser agent**, enter `windowproof-qwen` as the model. This loopback route requires no user key. To use another compatible router, enter a model and supply a key if its provider requires one. The browser runs the network, sends the evidence to the selected model route, and holds the key for the current page only. The archive servers receive no model key.

## Host

To prepare a hosted build, set `WINDOWPROOF_DESK_ORIGIN`, `WINDOWPROOF_LISTINGS_ORIGIN` and `WINDOWPROOF_RULES_ORIGIN` to three different HTTPS origins before running `node build.mjs`. Deploy the desk and archive file sets to their corresponding roots. All public JSON files need the correct content type and `Access-Control-Allow-Origin: *`. Publish the browser modules with a JavaScript MIME type. Set `WINDOWPROOF_ROUTER` only to a credentials-free URL. Run the browser comparison on the published origins before sharing the desk URL. The optional loopback route belongs to the local server.

`evidence.json` stores the 20 November 2026 snapshots and original source links. The source records are curated once. Follow the original source for current rules and eligibility.

The browser runtime in `public/runtime/` is copied from Cognizant AI Lab's [agentic-web repository](https://github.com/cognizant-ai-labs/agentic-web/tree/45dedb1558ed55c34bd49a77670b7be620f4d38b). See its Apache 2.0 terms in `UPSTREAM-LICENSE.txt` and `public/runtime/LICENSE.txt`.
