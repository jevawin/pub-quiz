# Feedback Dossier — open question_feedback (29 rows, 28 questions)

Snapshot 2026-05-30 from `question_feedback WHERE resolved_at IS NULL`, joined to live question content. Self-contained so a fresh session can triage without DB reads. **Re-verify each question against the live DB before patching** — content may have changed since this snapshot.

Schema notes:
- `questions.difficulty` was DROPPED in Phase 2.4. Difficulty now = `question_categories.estimate_score` (0-100, score-range bands) per chosen category pill. Do not select `questions.difficulty`.
- `distractors` is a JSONB array — keep exactly 3.
- Resolve a row with: `UPDATE question_feedback SET resolved_at=now(), resolved_note='…' WHERE question_id='<id>' AND created_at='<ts>';` (use created_at to disambiguate multi-report questions).

## FB01 — `5aff8f40-2ed7-494d-b49e-fed93bdc1721` (2026-05-19T13:52:44)
- **Feedback:** Main answer correct — Rule 1 is “Once you have their money, you never give it back” (DS9: “The Nagus”).    Trivia box wrong though:    	•	1995 book “The Ferengi Rules of Acquisition” was Ira Steven Behr alone (credited “by Quark as told to Behr”). Behr + Robert Hewitt Wolfe co-wrote Legends of the Ferengi (1997).  	•	Book doesn’t contain “all 285 rules” — many of the 285 were never stated in canon or the books.
- **Q:** In "Star Trek", what is the Ferengi's First Rule of Acquisition?
- **Answer:** Once you have their money, you never give it back. 
- **Fun fact:** The Ferengi Rules of Acquisition were expanded into a real published book in 1995 containing all 285 rules, written by Ira Steven Behr and Robert Hewitt Wolfe.
- **Status:** published

## FB02 — `8fa7d153-04e6-4cf3-baf3-c129e06afc97` (2026-05-18T16:39:33)
- **Feedback:** Chuck was not happy with this, do better
- **Q:** What is the standard frame rate for animation?
- **Answer:** 24 FPS
- **Fun fact:** Traditional animation uses 24 frames per second, but animators often draw only 12 unique frames and show each twice, a technique called animating 'on twos.'
- **Status:** published

## FB03 — `092ec0b3-98f9-4db2-9e62-1ae4229a0e03` (2026-05-18T16:20:42)
- **Feedback:** Mom > mother
- **Q:** What is the profession of Elon Musk's mom, Maye Musk?
- **Answer:** Model
- **Fun fact:** Maye Musk appeared on the cover of Time magazine's health edition at age 69 and has modelled for CoverGirl, making her one of the oldest spokesmodels for the brand.
- **Status:** published

## FB04 — `1b4cfeb3-7871-4189-a90c-f1d71503e422` (2026-05-18T16:14:31)
- **Feedback:** Unclear question- over a tine period ? Max power draw?
- **Q:** Generally, which component of a computer draws the most power?
- **Answer:** Video Card
- **Fun fact:** High-end gaming graphics cards can draw over 400 watts of power alone, more than an entire laptop uses under heavy load.
- **Status:** published

## FB05 — `8f808c6b-196f-4af9-8d19-44c6ddc6df27` (2026-05-18T15:58:35)
- **Feedback:** Weird word phrasing
- **Q:** When Magic: The Gathering was first solicited, which of the following was it originally titled?
- **Answer:** Mana Clash
- **Fun fact:** Magic: The Gathering, released in 1993, was the world's first trading card game and has since printed over 20,000 unique cards across dozens of expansions.
- **Status:** published

## FB06 — `0927b6e9-5622-4edd-993b-b026c85c18df` (2026-05-18T15:35:32)
- **Feedback:** Penis isn’t an option
- **Q:** What is the name of the talking cat in Persona 5?
- **Answer:** Morgana
- **Fun fact:** Morgana in Persona 5 insists he is not a cat despite clearly being one, and transforms into a bus for the team to travel in the Metaverse.
- **Status:** published

## FB07 — `c2cbf357-3158-465b-a892-d878fc14f68c` (2026-05-17T22:10:59)
- **Feedback:** American centric
- **Q:** Red Vines is a brand of what type of candy?
- **Answer:** Licorice
- **Fun fact:** Red Vines have been made by the American Licorice Company since 1952. Despite the name, the classic Red Vines flavour is actually 'original red' — not traditional licorice.
- **Status:** published

## FB08 — `ecf8ceb3-916f-446c-ae98-33731c1bbbc7` (2026-05-15T10:51:42)
- **Feedback:** Fewer than 10 hours?
- **Q:** Which planet completes one full rotation in less than 10 hours—the fastest day in the Solar System?
- **Answer:** Jupiter
- **Fun fact:** Jupiter's day is so short that its equator bulges outward like a spinning ball of dough—it's 5,000 km wider around the middle than pole to pole, even though nothing's physically pushing it out.
- **Status:** published

## FB09 — `6b3198ad-7fcd-4841-a4b2-58e2dba81d75` (2026-05-11T17:36:51)
- **Feedback:** “Who worked with”
- **Q:** Terry Gilliam was an animator that worked with which British comedy group?
- **Answer:** Monty Python
- **Fun fact:** Terry Gilliam was the only American member of Monty Python and created over 30 minutes of animation for the TV series using a distinctive cut-out collage technique.
- **Status:** published

## FB10 — `c1feb5ea-d11b-466c-adc0-692fdcb2f49d` (2026-05-10T14:06:43)
- **Feedback:** I don't understand this fact.
- **Q:** Donald J. Trump's Middle Name is...
- **Answer:** John
- **Fun fact:** Donald Trump is one of only a handful of US presidents whose middle name starts with J, joining John F. Kennedy and Lyndon B. Johnson among others.
- **Status:** published

## FB11 — `760c02a0-a7b9-470d-a844-7a9e4cbf6765` (2026-05-10T14:03:53)
- **Feedback:** 'mytological' probably should be 'mythological'.
- **Q:** What mytological creatures have women's faces and vultures' bodies?
- **Answer:** Harpies
- **Fun fact:** In the Aeneid, harpies tormented the Trojans by snatching and fouling their food whenever they tried to eat, driving them from island to island.
- **Status:** published

## FB12 — `f8f93c73-4bc5-4e8f-af1b-bf87350840bc` (2026-05-10T08:29:33)
- **Feedback:** Not a hard question for science. More like a medium general knowledge one
- **Q:** What was the first sport to have been played on the moon?
- **Answer:** Golf
- **Fun fact:** Astronaut Alan Shepard hit two golf balls on the Moon during the Apollo 14 mission in 1971, using a makeshift club fashioned from a six-iron head and a sample collector handle.
- **Status:** published

## FB13 — `cb32b2de-5e89-4d4a-bbf7-59222059eb6e` (2026-05-10T08:14:18)
- **Feedback:** Medium to hard difficulty in general knowledge
- **Q:** Which retro video game was released first?
- **Answer:** Space Invaders
- **Fun fact:** Space Invaders was so popular in Japan after its 1978 release that it caused a national coin shortage, prompting the government to triple yen production.
- **Status:** published

## FB14 — `d2cfe267-51f3-4e81-99a3-344ac738c01b` (2026-05-10T08:12:15)
- **Feedback:** More of a medium-difficulty question
- **Q:** The mountainous Khyber Pass connects which of the two following countries?
- **Answer:** Afghanistan and Pakistan
- **Fun fact:** The Khyber Pass sits at about 1,070 metres elevation and has been a crucial trade and invasion route for thousands of years, used by Alexander the Great and Genghis Khan.
- **Status:** published

## FB15 — `8c965d9f-2fc0-4214-9194-5d2a0ab0b9c0` (2026-05-10T08:11:43)
- **Feedback:** Little too hard for a general knowledge round on easy
- **Q:** What company created and developed the game "Overwatch"?
- **Answer:** Blizzard Entertainment
- **Fun fact:** Overwatch began life as Project Titan, an ambitious MMO that Blizzard scrapped after seven years of development before salvaging its team-based combat into a standalone shooter.
- **Status:** published

## FB16 — `00fb2eb5-4a4e-4956-b4a2-f9e35e8ba0d4` (2026-05-08T21:10:37)
- **Feedback:** Is Steve Trevor a superhero?
- **Q:** Which of the following superheros did Wonder Woman NOT have a love interest in?
- **Answer:** Green Arrow
- **Fun fact:** Wonder Woman was created in 1941 by William Moulton Marston, a psychologist who also invented an early version of the lie detector — inspiring her Lasso of Truth.
- **Status:** published

## FB17 — `00fb2eb5-4a4e-4956-b4a2-f9e35e8ba0d4` (2026-05-08T21:09:06)
- **Feedback:** Again superheroes don’t feel like literature need another cat for them
- **Q:** Which of the following superheros did Wonder Woman NOT have a love interest in?
- **Answer:** Green Arrow
- **Fun fact:** Wonder Woman was created in 1941 by William Moulton Marston, a psychologist who also invented an early version of the lie detector — inspiring her Lasso of Truth.
- **Status:** published

## FB18 — `055f3644-b147-46ef-bcc1-6174f8314c49` (2026-05-08T20:56:20)
- **Feedback:** Fact weird 1500 is the year, 1500s?
- **Q:** Albrecht Dürer's birthplace and place of death were in...
- **Answer:** Nürnberg
- **Fun fact:** Dürer was one of the first artists to create a series of self-portraits, including a striking 1500 painting where he posed in a Christ-like manner.
- **Status:** published

## FB19 — `03dd8ef4-0287-4db2-99fc-e92aa7238cef` (2026-05-08T20:52:23)
- **Feedback:** Video Sledgehammer all title car should video be lower or is that part of the name, if name should be quoted
- **Q:** Which company did the animation for Peter Gabriel's Video Sledgehammer (1986)?
- **Answer:** Aardman Animations
- **Fun fact:** Aardman Animations used stop-motion claymation techniques for the Sledgehammer video — the same studio later created Wallace & Gromit and Shaun the Sheep.
- **Status:** published

## FB20 — `04384032-9fe3-448a-bd4b-4d55110700d1` (2026-05-08T20:51:02)
- **Feedback:** Mostly entirely
- **Q:** "Rollercoaster Tycoon" was programmed mostly entirely in...
- **Answer:** x86 Assembly
- **Fun fact:** Chris Sawyer wrote 99% of RollerCoaster Tycoon in assembly language by hand, an astonishing feat that helped the game run smoothly on the modest PCs of 1999.
- **Status:** published

## FB21 — `00356aeb-8a66-4858-bca3-a2b19240ab89` (2026-05-08T20:44:57)
- **Feedback:** Repeat question, we need to check the question memory logic
- **Q:** If you were to write software using 1s and 0s, what would you be writing in?
- **Answer:** Binary
- **Fun fact:** Early programmers literally toggled binary switches on front panels to enter programs. Grace Hopper's team invented the first compiler in 1952 to escape this tedium.
- **Status:** published

## FB22 — `047b0fc8-eee1-4825-950e-0e1cce04d030` (2026-05-08T20:43:04)
- **Feedback:** Need a pop culture category, or maybe this should be movies and music
- **Q:** Which billionaire industrialist is Iron Man?
- **Answer:** Tony Stark
- **Fun fact:** Tony Stark was created in 1962 as Stan Lee's deliberate challenge to his anti-war readers — Lee wanted to make them root for a weapons manufacturer during the Cold War. It actually worked.
- **Status:** published

## FB23 — `132e86c1-906d-47fc-b767-daaae2a0b705` (2026-05-06T17:14:57)
- **Feedback:** 'disguise themselves into a woman' sounds wrong. Maybe it should be 'as a woman'.
- **Q:** In which movie does Robin Williams' character have to disguise themselves into a woman?
- **Answer:** Mrs. Doubtfire
- **Fun fact:** Robin Williams improvised so much during Mrs. Doubtfire that the crew often struggled to keep from laughing, and the film received an Oscar for Best Makeup.
- **Status:** published

## FB24 — `e0ad4271-87e9-42f3-9744-a90ea4efa8ee` (2026-05-05T20:49:13)
- **Feedback:** Single outer and single inner should probably be specified in the fact.
- **Q:** How many scoring zones are there on a conventional dart board?
- **Answer:** 82
- **Fun fact:** A standard dartboard has 20 numbered segments, each with single, double, and treble zones, plus the outer bull and bullseye, totalling 82 scoring areas.
- **Status:** published

## FB25 — `0325a30f-5f96-47b7-9438-0b1acab45153` (2026-05-05T14:37:53)
- **Feedback:** Answer in question, blowtorched on top?
- **Q:** Which custard-based French dessert is brûléed with a torch?
- **Answer:** Crème brûlée
- **Fun fact:** Trinity College Cambridge claimed it as their own in 1879, branding the college arms right onto the top with a hot iron — but the French had been torching custard since at least 1691.
- **Status:** published

## FB26 — `00b5173f-eee5-459b-99f2-49c57df65b7b` (2026-05-05T14:35:47)
- **Feedback:** Grammar chef’s
- **Q:** What was Raekwon the Chefs debut solo album?
- **Answer:** Only Built 4 Cuban Linx
- **Fun fact:** Only Built 4 Cuban Linx is often called 'The Purple Tape' because it was originally released on a purple cassette, becoming a coveted collector's item.
- **Status:** published

## FB27 — `092ec0b3-98f9-4db2-9e62-1ae4229a0e03` (2026-05-04T08:34:17)
- **Feedback:** mom = American, we should make language universal English where possible "mother"
- **Q:** What is the profession of Elon Musk's mom, Maye Musk?
- **Answer:** Model
- **Fun fact:** Maye Musk appeared on the cover of Time magazine's health edition at age 69 and has modelled for CoverGirl, making her one of the oldest spokesmodels for the brand.
- **Status:** published

## FB28 — `7ce1283a-2b4c-4714-a600-dc11917c4573` (2026-05-03T21:45:35)
- **Feedback:** Ah, I get it now. Sorry.
- **Q:** Which of these countries is NOT the only country to start with that letter of the alphabet?
- **Answer:** Zambia
- **Fun fact:** Zimbabwe and Zambia both start with Z, which is why Zambia is the correct answer — it shares its starting letter with another country.
- **Status:** published

## FB29 — `7ce1283a-2b4c-4714-a600-dc11917c4573` (2026-05-03T21:44:12)
- **Feedback:** Maybe it does make sense, but I have no idea what this question is asking. I guess we will see when I answer.
- **Q:** Which of these countries is NOT the only country to start with that letter of the alphabet?
- **Answer:** Zambia
- **Fun fact:** Zimbabwe and Zambia both start with Z, which is why Zambia is the correct answer — it shares its starting letter with another country.
- **Status:** published
