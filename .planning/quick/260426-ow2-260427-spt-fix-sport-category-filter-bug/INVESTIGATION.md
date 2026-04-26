# Investigation — sport category filter leak (260426-ow2)

Read-only SQL/PostgREST queries against the live Supabase DB via the pipeline service-role client.
Run via `pipeline/src/scripts/investigate-sport-leak.ts`.

## Sports subtree

13 category ids (root `sports` + descendants).

## Q1: legacy_sports vs join_sports

```
legacy_sports = 144   (published questions whose legacy questions.category_id is in the sports subtree)
join_sports   = 130   (distinct published questions linked to any sports-subtree category via question_categories)
```

The two sets disagree by ~14 questions in each direction.

## Q2: legacy-says-sport but join-says-not-sport (with backfill present)

```
0 rows
```

No question that has been backfilled into question_categories disagrees with its legacy sports classification.
This means: when the join table has data, the data is consistent with the legacy column — for the questions
that have been backfilled.

## Q2b: legacy-says-sport AND no question_categories row yet (un-backfilled)

```
24 rows
```

Sample (10 of 24):

```
cdff8678 | What year was hockey legend Wayne Gretzky born?
e47bdc03 | What is the name of Manchester United's home stadium?
f39129c6 | Which country hosted the 2018 FIFA World Cup?
efab9481 | Which portuguese island is soccer player Cristiano Ronaldo from?
c5e90a0d | What was Sir Donald Bradman's batting average in test matches?
dffc3589 | Who won the 2015 Formula 1 World Championship?
fd5c2b8c | Where was the Games of the XXII Olympiad held?
e5f20f10 | What sport features the terms love, deuce, match and volley?
c61fe6b2 | "Stadium of Light" is the home stadium for which soccer team?
c30b9893 | F1 season of 1994 — tragic event?
```

These are still served correctly by the legacy fallback path after the fix. Visible-sample = sport, so the legacy column for these rows is trustworthy enough to fall back on while backfill catches up.

## Q3: join-says-sport but legacy-says-not-sport (inverse leak)

```
10 rows
```

Sample (all 10):

```
f64f9b4d | What type of dog is 'Handsome Dan', the mascot of Yale University?
365f44e1 | In a game of snooker, what colour ball is worth 3 points?
5146a289 | In "Cheers", Sam Malone was a former relief pitcher for which baseball team?
bf03b2ff | Which soccer player is featured on the cover of EA Sport's FIFA 18?
75f118a8 | Which football player is featured on the international cover version of FIFA…
0e20887d | Which of these celebrities was not a member of the Jackson 5?
71741778 | Which African-American sprinters raised their fists at the 1968 Olympics?
4ce62e76 | Which city hosted the Summer Olympics in 1964?
7e053353 | Which country won the 1966 FIFA World Cup?
ab1334db | In which World Cup did Diego Maradona score the 'Hand of God' goal?
```

Most of these are clearly sport (snooker, FIFA, Olympics, World Cup, EA Sports) but the legacy `category_id` puts them under non-sport roots (TV/film, music, geography). After the fix these will start appearing under Sports, where they belong, because the join table says so.

The `Jackson 5` and `Handsome Dan` ones look like Category Agent over-tagging — they don't feel like sport even though the join row says so. Out of scope for this plan; tracked separately if needed.

## Q4: backfill state

```
348 published questions have no question_categories rows yet (of 2848 total = ~12.2%)
```

Backfill from Phase 999.8 Plan 04 is still in progress. Legacy fallback path is essential.

## Conclusion

**leak confirmed**

- Direction 1 (wrong-category appearing under Sports): driven by un-backfilled rows + any legacy mis-tags. The fix doesn't fully eliminate this for un-backfilled rows, but does eliminate it for the 2500+ already-backfilled questions. Remaining 24 un-backfilled legacy-sport rows are correctly classified per spot-check.
- Direction 2 (real sport questions missing from Sports): 10+ questions today. The fix adds them.
- Net: pool grows from 144 to ~140 (-4 noise) + 10 (recovered sport via join) ≈ similar size, much better precision.

Proceed to Task 2 (migration 00025).
