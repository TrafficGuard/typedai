
Written by **Daksh Gupta**

I'm Daksh, one of the co-founders of [Greptile](https://www.greptile.com/). We're building AI that understands codebases, which you can query using an [API](https://www.greptile.com/docs/api-reference/introduction). To do this, we have to, depending on the task, provide an LLM with snippets from the codebase, ideally the fewest number of snippets that give it _sufficient_ information to respond to the query.

![Semantic search illustration](https://i.imgur.com/iHO15Hg.png)

We found out that this problem is harder than it looks. Before we get into all the ways we tried to make codebase semantic search work, it's interesting to see why it's different from semantically searching a book.

### [](#semantically-searching-a-book)Semantically searching a book

First, we index the corpus we are trying to search over:

1.  Split it up into units (or "chunks"), each one ideally about distinct topics. Splitting by paragraph is a good approximation of this.
2.  Generate semantic vector embeddings for each "chunk".

Semantic vector embeddings capture the semantic meaning of a piece of text as an _n_\-dimensional vector. The algorithm to create them is quite fascinating and is explained very well in chapter 6 of Speech and Language Processing, available for free [**here**](https://web.stanford.edu/~jurafsky/slp3/6.pdf).

When two pieces of text are semantically similar, their vectors are too, which can be quantified by their cosine similarity or normalized dot product. You could say, therefore, that the semantic similarity between two pieces of text **_t₁_,** **_t₂_** is:

![dot product of v_1 and v_2](https://i.imgur.com/45cqysn.png)

Where **_v₁_** is the normalized semantic embedding vector for text **_t₁_** and **_v₂_** is the normalized semantic embedding vector for text **_t₂_**.

![Indexing](https://i.imgur.com/MwUlyRy.png)

To retrieve, we start by generating a semantic vector embedding for the query, in this case, "Word storing frequently accessed key-value pairs". We then compare that against our database of vectors and find the one(s) that match the closest, i.e., have the highest dot product and highest similarity.

![Retrieval](https://i.imgur.com/9gOntK6.png)

In theory, this should work for codebases too. Surely you could split up a codebase into files or functions as the “chunks”, embed them, and do a similar semantic similarity-based search. We tried this, and got fairly poor results even with simple queries like “Session management code”, which should have retrieved the files associated with session management, and instead naively picked up files that mentioned “management” or “session”, since those files were the most semantically similar.

### [](#code-and-natural-language-are-not-semantically-similar)Code and natural language are not semantically similar

Here I have a [natural language query](https://www.greptile.com/docs/introduction), with which I want to search a codebase to find where the code for HFT fraud detection is.

    query = "Get the code that detects potential fraud in HFT transactions"


This is the code I am hoping the search will return:

    from collections import defaultdict
    
    def analyze_high_frequency_transactions(
        transactions: List[Dict[str, any]],
        time_window: timedelta,
        amount_threshold: float,
        frequency_threshold: int
    ) -> Tuple[List[Dict[str, any]], Dict[str, List[datetime]]]:
    
        def is_suspicious(times: List[datetime]) -> bool:
            if len(times) < frequency_threshold:
                return False
            times.sort()
            for i in range(len(times) - frequency_threshold + 1):
                if times[i + frequency_threshold - 1] - times[i] <= time_window:
                    return True
            return False
    
        suspicious_transactions = []
        account_timestamps = defaultdict(list)
    
        for transaction in transactions:
            account = transaction['account_id']
            amount = transaction['amount']
            timestamp = datetime.fromisoformat(transaction['timestamp'])
    
            if amount >= amount_threshold:
                account_timestamps[account].append(timestamp)
    
                if is_suspicious(account_timestamps[account]):
                    suspicious_transactions.append(transaction)
    
        flagged_accounts = {
            account: timestamps
            for account, timestamps in account_timestamps.items()
            if is_suspicious(timestamps)
        }
    
        return suspicious_transactions, flagged_accounts



Here is an English description of what the code does:

    This function analyzes a list of financial transactions to identify potentially suspicious high-frequency trading patterns. It flags transactions and accounts that meet specific criteria:
    
    1. Transactions with amounts above a certain threshold.
    2. Accounts with a high frequency of such transactions within a specified time window.
    
    The function takes four parameters:
    
    - A list of transaction dictionaries
    - A time window for analysis
    - An amount threshold for transactions
    - A frequency threshold for the number of transactions
    
    It returns two items:
    
    1. A list of suspicious transactions
    2. A dictionary of flagged accounts with their transaction timestamps
    
    The function uses nested helper functions and defaultdict for efficient processing. It's designed to handle large datasets and could be part of a larger financial monitoring system.


I computed the semantic similarity between the query and code, and then between the query and the natural language code description. Here is what I found:

Comparison

Similarity

Query and code

0.7280

Query and description

0.8152

The similarity between the query and the description is meaningfully higher (12%) than the similarity between query and description. This _should_ mean that searching over a natural language summary of the codebase should yield better results than searching over the code.

### [](#chunking-and-noise)Chunking and noise

Another aspect is the signal-to-noise ratio of the chunk that was embedded.

In the indexing step if you chunk the codebase by file (every file being one vector), you might include a lot of code that isn’t relevant to the query.

Here we examine three scenarios, and see the semantic similarity each one has with the query `"Get the code that detects potential fraud in HFT transactions"`

1.  Full file of random code
2.  Full file of random code with correct function buried in between
3.  Just the correct function

Interestingly, adding noise dramatically reduces the semantic similarity, to a point where the performance is closer to if it were just noise than if it was just the correct function.

Scenario

Similarity

Query and full file

0.718032

Query and full file with function

0.739421

Query and just the function

0.768347

### [](#summary)Summary

*   Semantic search on codebases works better if you first translate the code to natural language, before generating embedding vectors.
*   It also works better if you chunk more “tightly” - on a per-function level rather than a per-file level. This is because noise negatively impacts retrieval quality in a huge way.