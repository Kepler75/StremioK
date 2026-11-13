# Translating StremioK

StremioK's menus, buttons and messages come in English and the languages listed in Settings ›
Appearance › *Language*. Each language is one plain file in the `translations/`
folder: you can correct one, or start a new one, from GitHub without touching the app's code.

## Correct a translation
1. Open `translations/<code>.json` on GitHub (`es.json` for Spanish, `pt-BR.json` for Brazilian
   Portuguese) and choose **Edit**.
2. Find the English phrase (on the left) and change its translation (on the right).
3. Propose the change; GitHub opens a pull request for it.

## Add a language
1. Copy `translations/template.json` to `translations/<code>.json`: a language code such as `fr`,
   or with its country, such as `fr-CA`.
2. Fill in its `language` part (below), then translate the phrases.
3. Leave a phrase as `""` until it's done: it shows in English meanwhile. A language is offered
   in Settings once 90% of its phrases are translated, so it can come in more than one go.

| `language` part | What it holds |
|---|---|
| `code` | The file's own name, without `.json` |
| `name` | The language's name in itself (`Français`), as Settings lists it |
| `matches` | The TV languages that pick it under *Automatic*, such as `["fr"]` for every French |
| `plural` | How numbers change the words that follow them (below) |
| `direction` | `"rtl"` for a language written right to left (Arabic, Hebrew); left out otherwise |

| `plural` | Forms | Languages |
|---|---|---|
| `"one"` | one (1), other | English, Spanish, Catalan, German, Italian, Finnish |
| `"zero-one"` | one (0 and 1), other | Portuguese, French, Hindi |
| `"none"` | other (always) | Japanese, Korean, Chinese, Turkish |
| `"slavic"` | one (1, 21, 31…), few (2–4, 22–24…), many (the rest) | Russian, Ukrainian |
| `"polish"` | one (1), few (2–4, 22–24…), many (the rest) | Polish |
| `"hebrew"` | one (1), two (2), other | Hebrew |
| `"arabic"` | zero, one, two, few (3–10), many (11–99), other | Arabic |

## Rules for a translation
- Keep each `{name}` exactly as written: StremioK puts a title, a number or a name there. It can
  move within the sentence.
- Keep a space at the start or end of a phrase if the English has one: it joins two pieces.
- Keep symbols such as `›`, `·` and emoji; menu paths (`Settings › Content`) use the translated
  names of those screens.
- Pairs such as `"{n} episode"` and `"{n} episodes"` are the singular and plural of one phrase.
  Where a language has more forms, the plural's translation lists them by name:
  `"{n} episodes": { "few": "{n} odcinki", "many": "{n} odcinków" }`.
- Never change the English side: StremioK finds a phrase by its exact English text.
- Stay about as short as the English where you can: buttons and rows on a TV have little room.

## Check a file
With [Node.js](https://nodejs.org) installed, run `node translations/build.js` from the project's
folder. It lists anything wrong (a `{name}` changed or missing, a phrase StremioK doesn't show,
a misspelled `language` part) and how much of each language is translated. When nothing is wrong
it also updates what the TV loads (`js/lang/`), so commit those files with yours.

When StremioK gains new phrases, they're added to every language's file as `""`; a phrase
reworded in English is reported as no longer shown, and its new wording waits to be translated.
