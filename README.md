# Summit General Contracting — Demo Site

A polished static marketing site. No database, no login, no build step. Open `index.html` in a browser and it just works.

---

## What's Here

```
summit/
├── index.html       # Landing page
├── services.html    # Services + pricing
├── portfolio.html   # Filterable project gallery with before/after modal
└── README.md
```

---

## Deploy to Vercel in 3 Minutes

1. **GitHub:** go to [github.com/new](https://github.com/new), create a new public repo (e.g. `summit-gc`)
2. On the empty repo page, click **"uploading an existing file"** → drag all the files from the `summit` folder in → scroll down, click **Commit changes**
3. **Vercel:** go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, pick your repo, click **Deploy**

You'll get a live URL like `summit-gc.vercel.app` in under a minute. Every time you push changes to GitHub, Vercel auto-deploys.

> Tip: to preview locally first, just double-click `index.html` — it opens in your browser and works identically.

---

## What to Customize

Find-and-replace across the three HTML files:

| Placeholder | Where to find it |
|---|---|
| `(555) 123-4567` / `5551234567` | Phone number — update in nav, hero, footer |
| `info@summitgc.example` | Email address |
| `123 Main St`, `Your City`, `ST` | Physical address (in the JSON-LD block at the top of `index.html`) |
| `Lic. # 0000000` | License number in footer |
| `4.9★` / `127` reviews | Hero trust bar + JSON-LD (if you want real numbers) |
| Hero background image | `.hero-bg` CSS in `index.html` — swap the Unsplash URL |
| Portfolio photos + copy | `portfolio.html` — the `projects` array near the bottom |
| Testimonials | `index.html` — the 4 testimonial cards in the `#testimonials` section |
| Brand colors | `tailwind.config` block at the top of each file — `brand` (navy) + `accent` (amber) |

---

## About the Quote Form

The form is in **demo mode** — it shows a success message but doesn't actually send anything anywhere. That's fine for showing off the site.

When you're ready for real leads, the easiest wire-up is [Formspree](https://formspree.io) (free tier: 50 submissions/month, emails leads directly to you):

1. Sign up at formspree.io, create a form, copy the endpoint URL
2. In `index.html`, find `<form id="quote-form"` and change it to:
   ```html
   <form id="quote-form" action="https://formspree.io/f/YOUR-ID" method="POST" ...>
   ```
3. Delete the `<script>` block at the bottom of `index.html` that handles form submission
4. That's it — Formspree handles everything and emails you each lead

Other options: [Web3Forms](https://web3forms.com), [Getform](https://getform.io), [Netlify Forms](https://docs.netlify.com/forms/setup/) (free if you deploy on Netlify instead of Vercel).

---

## Notes

- Placeholder phone numbers use `555-xxxx` format (reserved, not in service).
- Unsplash images are hotlinked and free. For production, download them or use your own.
- Tailwind is loaded via CDN — simple and works, but the CSS file is ~3MB. If site speed becomes a concern later, swap to the [Tailwind standalone CLI](https://tailwindcss.com/blog/standalone-cli) for a tiny compiled file.

That's it. Have fun.
