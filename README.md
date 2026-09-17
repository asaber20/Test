# ChatApp — a WhatsApp-style chat web app

A small, dependency-free chat web app with a WhatsApp-like interface. Say **"hi"**
and the bot replies **"hi"**.

![chat](https://img.shields.io/badge/stack-HTML%20%2B%20CSS%20%2B%20vanilla%20JS-00a884)

## Run it

No build step, no install. Either:

```bash
# open directly
open index.html          # macOS   (use `xdg-open index.html` on Linux)

# or serve it locally
npx http-server . -p 8080   # then visit http://localhost:8080
```

## What it does

- **WhatsApp-style UI** — dark theme, chat list sidebar, message bubbles with
  tails, timestamps, sent/read ticks (✓ / ✓✓) and `Today` / `Yesterday` dividers.
- **Bot replies** — send `hi` and the bot answers `hi`. It also handles
  `how are you`, `who are you`, `thanks`, `what time is it`, `tell me a joke`,
  `help` and `bye`, with a friendly fallback for anything else.
- **Typing indicator** — the bot "types" for a moment before answering, with the
  delay scaled to the length of its reply.
- **Three chats** — `Bot` (the rule-based bot), `Echo Bot` (repeats what you
  send), and `Notes (you)` (a self-chat where nothing replies).
- **Reply queue** — fire off several messages in a row and each one still gets
  its own answer, in order.
- **Persistence** — conversations are kept in `localStorage`, so a reload
  restores your history. `Clear` empties the open chat.
- **Unread badges** — messages that arrive while you're in another chat show a
  green counter in the sidebar.
- **Search** — filters the chat list by contact name or last message.
- **Responsive** — side-by-side on desktop; on narrow screens the list and the
  conversation become separate views with a back button.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: sidebar, conversation pane, composer. |
| `styles.css` | Theme tokens, layout, bubbles, typing animation, responsive rules. |
| `bot.js` | Reply engine: normalization, ordered match rules, fallbacks. Exposed as `window.Bot`. |
| `app.js` | Chat list, message rendering, reply queue, `localStorage` persistence. |

## Teaching the bot something new

Rules live in `bot.js` and are checked in order — the first match wins. Add one
to the `RULES` array:

```js
{
  name: "weather",
  match: contains("weather", "is it raining"),
  reply: ["Sunny where I am ☀️", "Looks like rain 🌧️"]
}
```

`match` receives the normalized text (lowercased, punctuation stripped), and
`reply` can be a string, an array to pick from at random, or a function
returning the text.

## Notes

The bot runs entirely in the browser — there is no server and nothing leaves the
page, so replies are rule-based rather than generated. To wire it to a real
backend or model API, replace the body of `Bot.reply` with a `fetch` call and
have `send()` in `app.js` await it.
