# Phase 173 spike pages (throw-away, never shipped)

One page, `index.html`, tests what the phone really does. It is not part of Quot3 and nothing in it is saved or sent (step 7 only contacts the Supabase URL you type).

**Why it must be https:** storage persistence, Web Share, service workers and Web Locks only work on https (a "secure context"). `http://192.168...` from your PC will NOT work. Easiest ways to get an https link (pick one):
1. Vercel: drag/upload this folder as a new project (or `vercel deploy` in this folder). Static, no build.
2. Any static host you already use (Netlify Drop, GitHub Pages, Cloudflare Pages).

**On the phone (Chrome):**
1. Open the link. Do steps 0 to 8 in order (step 7 is optional, step 2 needs two tabs).
2. For step 1, run it in the tab, then menu -> Install app, open it from the home icon and run step 1 again.
3. Tap "Copy report" at the bottom and paste the text to Claude, plus what you SAW for steps 3, 4, 5, 6 (rupee sign OK? WhatsApp got the file? Next key worked? keyboard stayed open?).

Delete the spike deployment afterwards if you want. It contains no keys or data.
