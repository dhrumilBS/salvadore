# Prompt: write the text for Botphonic blog covers

Use this with ChatGPT, Gemini, Copilot, Kiro or any AI assistant.
Copy everything between the two lines below, paste it into a new chat, then add your article(s) where it says.
The assistant only writes text. The image itself is made by Botphonic Cover Studio (index.html in this folder) or make-covers.mjs, which keeps every cover identical in style.
Do not ask the assistant to draw or generate the image: image generators redraw from scratch and will not match the set.

---

You write the text for Botphonic blog feature images. A separate tool draws the image. For each article I give you, you return exactly one line in this format and nothing else (no table, no bullets, no explanations):

POST URL | COVER TITLE | SECOND LINE | STYLE

POST URL
- The article's full URL, for example https://botphonic.ai/blog/ai-receptionist-for-law-firms/
- If I give you only a title, make the slug from the main keyword: lowercase words joined by hyphens, no year, no stop words like "the", "a", "in", "for" unless needed for meaning.

COVER TITLE
- 3 to 7 words and at most 44 characters.
- Sentence case: capitalise only the first word and names. No year. No full stop. No emoji. No quotes.
- Numbers as digits: "6 Vapi alternatives", "8 best AI sales assistants".
- Spell names exactly like this: Botphonic, Bland AI, Air AI, Vapi, Retell AI, Synthflow, PolyAI, Cognigy AI, Parloa, Goodcall, Voiceflow, Kore.ai, Aivo, Twilio, Smith.ai, CallHippo, Verloop.io, Aircall, VoiceSpin, Lindy, Seamless.AI, Salesforce, HubSpot, Zoho, HIPAA, ROI, CRM, API.

SECOND LINE
- At most 45 characters. The article's promise, taken from its subtitle, intro or first heading.
- Sentence case. No year. No full stop at the end (a question mark is fine).

STYLE
Exactly one of these ten words. Use the first rule that matches:
1. Versus: "X vs Y" comparisons, pros and cons
2. Bands: alternatives to a product
3. Review: a review of one product
4. Corners: pricing, cost, plans
5. Dusk: after hours, front desks, clinics, dealerships, phone systems
6. Door: booking, appointments, scheduling
7. Crowd: problems such as call spikes, angry or frustrated callers, missed calls
8. Rise: sales, leads, prospecting, ROI, growth
9. Gap: waiting, hold time, saving time
10. Silk: everything else (guides, explainers, how it works, best-of lists)

Examples from covers already on the blog:
https://botphonic.ai/blog/handle-call-center-call-volume-spike/ | When call volume suddenly spikes | What to do in the first hour | Crowd
https://botphonic.ai/blog/reduce-hold-time-call-center/ | Reduce hold time in your call center | 10 fixes, ranked by cost | Gap
https://botphonic.ai/blog/best-ai-call-center-software-for-dealerships/ | AI call center for car dealerships | For the calls that come after closing | Dusk
https://botphonic.ai/blog/best-ai-appointment-booking-tool-for-home-services/ | AI booking for home services | Jobs, crews and emergencies | Door
https://botphonic.ai/blog/botphonic-vs-vapi/ | Botphonic vs Vapi | Choosing the right AI voice agent software | Versus
https://botphonic.ai/blog/vapi-alternative/ | 6 Vapi alternatives | Easier options for non-developers | Bands
https://botphonic.ai/blog/poly-ai-review/ | PolyAI review | Where it wins and where it breaks | Review
https://botphonic.ai/blog/ai-receptionist-pricing/ | AI receptionist pricing | The complete cost guide | Corners
https://botphonic.ai/blog/ai-receptionist-roi/ | The real ROI of an AI receptionist | 6 businesses, tracked for 6 months | Rise
https://botphonic.ai/blog/ai-phone-call-system-architecture-explained/ | AI phone call architecture | What every layer does and why it matters | Silk

Before you answer, check every line: the title has 3 to 7 words and at most 44 characters, the second line has at most 45 characters, there is no year, there are exactly three "|" separators, and the style is one of the ten words. Rewrite any line that fails, then output only the final lines.

My articles (title and URL, plus the intro or headings if you have them):

[PASTE YOUR ARTICLES HERE]

---

Then copy the lines it returns into the "Paste lines from ChatGPT" box in the studio and press "Add these lines to this week", or save them as covers.txt for make-covers.mjs.
