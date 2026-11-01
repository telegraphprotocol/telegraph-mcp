# Intents, miners and ranking

## Intents

An intent is one kind of question, such as `CRYPTO_PRICE_USD`, `WEATHER_CHECK_TEMPERATURE` or `CODE_REVIEW_GENERAL`. Every miner declares the intents it serves. `telegraph_find_intents` searches them.

Intents come in families: a family name (a prefix such as `WEATHER_CHECK`) groups the intents that extend it with `_`. You ask an intent, never a family.

## Kinds

Each intent has a kind, which decides how its miners are checked:

- **deterministic**: one correct answer the network can confirm from public sources (a price, a rate, a temperature). Miners are compared with that answer.
- **hybrid**: a checkable fact plus a judged part.
- **judgment**: no single correct answer (a review, an analysis). A trained model scores the answers.

## Asking well

A plain question works: the node reads the intent and its params from it. To be exact, send `intent` and `params` as `telegraph_intent` lists them, for example `{"intent": "WEATHER_CHECK_TEMPERATURE", "params": {"location": "Lahore"}}`. With an intent, only that intent's miners answer; if none is live, the ask is refused before payment.

The answer comes back in the intent's fields (`answer` in the tool result), with `field_status` saying which fields were found. When the fields can't be read, `result_shape` is `raw` and the answer is the miner's own reply.

## Ranking

Every epoch (one hour on beta 2) the network asks each intent's miners questions and scores the answers. `telegraph_ranking` shows the result. An ask goes to the top live miner, with the next one as a fallback. A miner that stops answering is taken out of routing.

## Intents without a ranking

Some intents are not ranked yet: deterministic ones need reference answers from several independent sources, and judgment ones need a trained model. An ask for such an intent goes to a miner the node's language model picks, which is less reliable. `telegraph_intent` says when an intent has no ranking.
