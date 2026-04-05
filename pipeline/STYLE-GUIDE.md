# Pub Quiz Question Writing Style Guide

> **Gold standard.** This guide defines how questions should read, feel, and perform. The Questions Agent uses it as its primary reference. Changes require human approval — see 999.6 in the roadmap.
>
> Built from analysis of 2,552 Open Trivia Database questions (CC BY-SA 4.0), 4 professional trivia writing guides, and iterative testing of our own pipeline output.

---

## 1. The Pub Test

Every question must pass this test: **imagine a quizmaster reading it aloud to a room of people holding pints.** Would they nod, debate with their table, and have a reasonable shot at getting it right? Or would they reach for their phones?

Good questions make people say:
- "I know this!"
- "I used to know this..."
- "I think I can figure this out"
- "Oh, I should have known that!"

Bad questions make people say:
- "How would anyone know that?"
- "That's not even interesting"
- "According to WHAT reference material?"

---

## 2. Question Structure

### Length
- **Target: 40–80 characters.** If you can't read it aloud in one breath, it's too long.
- Easy questions average ~60 characters. Hard questions average ~70. Anything over 100 needs a rewrite.
- One idea per question. No compound questions.

### Phrasing
- Write as a direct question, not a fill-in-the-blank statement.
- Never reference source material ("according to the text", "based on the reference", "the article states").
- Use active, everyday language. "Who painted...?" not "By whom was ... painted?"
- Front-load the interesting part. "What did Alfred Hitchcock use as blood in Psycho?" is better than "In the 1960 Hitchcock film Psycho, what substance was used to simulate blood?"

### Question Types (by frequency in good pub quizzes)
| Type | Share | Example |
|------|-------|---------|
| **Which/What** | ~42% | "Which planet has the most moons?" |
| **Who** | ~15% | "Who was South Africa's first Black president?" |
| **How many/much** | ~8% | "How many planets are in our Solar System?" |
| **When/What year** | ~5% | "In what year did the Berlin Wall fall?" |
| **Where** | ~5% | "What is the capital of Jamaica?" |
| **Other** (superlatives, true/false style, "name the") | ~25% | "What is the best-selling album of all time?" |

Date questions ("What year did X happen?") should be used sparingly — they're "you know it or you don't" with no room for reasoning. Prefer questions where a table can debate and narrow down the answer.

---

## 3. Difficulty Calibration

### Distribution Target
| Level | Share | Definition | Example |
|-------|-------|------------|---------|
| **Easy** | 35–40% | Most people at a pub table would know | "What is the largest planet in the Solar System?" → Jupiter |
| **Normal** | 40–45% | Half the table might know, the rest can make a good guess | "Which famous leader is credited with saying 'Let them eat cake'?" → Marie Antoinette |
| **Hard** | 15–20% | One person at the table might know, but the answer is interesting | "What did Alfred Hitchcock use as blood in Psycho?" → Chocolate syrup |

### Calibration Rules
- **Easy means genuinely easy.** "What is the capital of Jamaica?" (Kingston) is easy. "In what year was Kingston founded?" is hard. Don't confuse topic familiarity with question difficulty.
- **Hard should still be guessable.** The best hard questions give you something to work with. "Which US President served the shortest term?" — you might not know it's William Henry Harrison, but you can reason about it.
- **Avoid "impossible" questions** that only specialists would know. If nobody at a table of 6 would get it, it's too hard for a pub quiz.
- **Per batch of 5 questions: at least 2 easy, 2 normal, at most 1 hard.** A pub quiz should be fun for everyone.

### The "It's Easy to Write Bad Hard Questions" Rule
Writing a question about the second moon of Jupiter is easy to do but terrible for a pub quiz. Writing a genuinely good easy question that's still interesting takes real skill. Prioritise accessible questions that everyone can engage with.

---

## 4. Distractors (Wrong Answers)

### The Three Rules
1. **Plausible but clearly wrong.** Every distractor should be something a reasonable person might guess. No joke answers, no obviously absurd options.
2. **Same category as the correct answer.** If the answer is a country, all distractors should be countries. If it's a year, all should be years in a similar range.
3. **Not too close.** Distractors shouldn't be arguably correct. If the question asks "largest" and the distractor is the second largest, you'll get disputes.

### Good Distractor Patterns
| Answer Type | Good Distractors | Bad Distractors |
|------------|-----------------|-----------------|
| A person | Other people from the same field/era | Random celebrities |
| A year | Nearby years (±5-20 years) | Years centuries apart |
| A country | Countries in the same region | Countries from other continents |
| A number | Numbers in the same order of magnitude | Wildly different numbers |
| A title/name | Similar works/things from the same domain | Unrelated items |

### Examples
- **Good:** "Who painted The Creation of Adam?" → Michelangelo (wrong: Leonardo da Vinci, Caravaggio, Rembrandt) — all Renaissance painters
- **Bad:** "Who painted The Creation of Adam?" → Michelangelo (wrong: Taylor Swift, a fish, the colour blue)
- **Good:** "What is the capital of Jamaica?" → Kingston (wrong: San Juan, Port-au-Prince, Bridgetown) — all Caribbean capitals
- **Bad:** "What is the capital of Jamaica?" → Kingston (wrong: Paris, Tokyo, New York)

---

## 5. Category-Specific Guidelines

### History
- Favour events most people have heard of (World Wars, moon landing, fall of Berlin Wall) over obscure dates.
- "What year" questions are fine for major events. Avoid them for minor ones.
- Connect to something vivid: "Which naval battle in June 1942 halted Japanese advances in the Pacific?" works because Midway is a famous answer.

### Geography
- Capital cities, famous landmarks, "which continent" — these work well.
- Avoid questions that depend on how you define boundaries (longest river, largest country).
- Superlative questions ("highest", "deepest", "largest") are pub quiz staples but must be unambiguous.

### Science & Nature
- Keep it accessible. "How many planets?" yes. "What is the atomic number of Hassium?" no.
- Animal questions are great pub quiz material — people find them fun and debatable.
- Avoid anything that reads like an exam question.

### Entertainment (Film, Music, TV)
- These are the heart of a pub quiz. Favour widely-known works over niche ones.
- "Which film..." and "Which band..." questions spark the most table debate.
- Avoid questions that require having seen a specific episode or read a specific book chapter.

### Food & Drink
- Origin stories work well ("What country does Gouda cheese come from?").
- Ingredient questions are fun ("What fruit is a key ingredient in a traditional Bellini?").
- Avoid chef-specific or restaurant-specific questions unless the person is very famous.

### Sports
- Stick to major events and records that casual fans would know.
- World Cup, Olympics, and league champions are fair game.
- Avoid statistics that only hardcore fans track.

---

## 6. Anti-Patterns

### Never Do These
| Anti-Pattern | Why It Fails | Fix |
|-------------|-------------|-----|
| "According to the reference material..." | Breaks the fourth wall — pub quiz questions don't reference sources | Remove the phrase entirely |
| Trick questions | Destroy trust. Players become suspicious of every question | Write tricky questions instead (fair misdirection, not gotchas) |
| Questions with multiple correct answers | Cause disputes and kill momentum | Add qualifiers or use multiple choice to constrain |
| Extremely long questions (100+ chars) | Can't be read aloud easily, confuse listeners | Split into a shorter question with a setup |
| "You simply know it or you don't" questions | No room for reasoning or debate | Add context or hints that let people narrow down |
| Niche specialist questions | Alienate most of the table | Ask yourself: would 3+ people at a random table have a chance? |
| Textbook phrasing | Feels like an exam, not a quiz | Rewrite as if you're speaking to a friend |

### Warning Signs in Generated Questions
- Question mentions a specific paragraph, section, or article
- Answer requires knowing an exact number that has no cultural significance
- All distractors are from a completely different domain than the answer
- Question is longer than the answer + all distractors combined
- Question uses academic jargon that a quizmaster wouldn't say out loud

---

## 7. The "Double Up" Technique

From the Trivia Hall of Fame: link an interesting fact to a hint, requiring the answer to meet two criteria. This makes hard questions accessible and defends against technicalities.

**Before:** "For what movie did Paul Newman win his first Oscar?"
**After:** "Paul Newman's only competitive Oscar was for a role he'd first played 25 years earlier. Name that movie."

**Before:** "What is the state bird of New Mexico?"
**After:** "Wile E. Coyote ought to be careful in New Mexico. What's the state bird there?" (Roadrunner)

This technique:
- Gives players something to work with even if they don't know the answer directly
- Adds an interesting fact that makes the question memorable
- Reduces ambiguity by narrowing the answer space

---

## 8. Accuracy & Verification

- Every answer must be verifiable against a reliable source. The source is your fact-check, not your audience.
- Beware urban myths that exist primarily as trivia answers (Great Wall visible from space = false).
- Superlatives change over time. "As of [year]" is safer than present tense for records.
- If multiple sources disagree (longest river, tallest mountain), either avoid the question or specify the measurement method.
- Sports records often exclude playoffs or alternative leagues — specify if needed.

---

## 9. Metrics

These are the benchmarks for a healthy question set:

| Metric | Target |
|--------|--------|
| Difficulty distribution | 35-40% easy, 40-45% normal, 15-20% hard |
| Question length | 40-80 characters average |
| Fact-check pass rate | >70% of generated questions should pass |
| QA pass rate | >80% of verified questions should pass QA |
| Source-reference phrases | 0% (auto-rewrite any that slip through) |
| Distractor quality | All same-domain as correct answer |

---

## Attribution

This style guide was built using questions from the [Open Trivia Database](https://opentdb.com/) (CC BY-SA 4.0) and principles from:
- [Trivia Hall of Fame — Writing Great Questions](https://www.triviahalloffame.com/writeq)
- [Know Brainer Trivia — How To Write Great Trivia](https://knowbrainertrivia.com.au/blog/how-to-write-great-trivia)
- [The Quiz Team — How to Write a Pub Quiz](https://thequizteam.com/how-to-write-a-pub-quiz-and-avoid-these-top-6-mistakes/)
- [TrivWorks — A Guide to Writing Excellent Trivia Questions](https://trivworks.com/2011/03/a-guide-to-writing-excellent-trivia-questions/)
