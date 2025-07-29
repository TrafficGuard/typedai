https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings

Get text embeddings

bookmark\_border Stay organized with collections Save and categorize content based on your preferences.

This document describes how to create a text embedding using the Vertex AI [Text embeddings API](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api).

Text embeddings are dense vector representations of text. For example, the [gemini-embedding-001](#supported-models) model generates 3072-dimensional vectors for a given piece of text. These dense vector embeddings are created using deep-learning methods similar to those used by large language models.

Unlike sparse vectors that map words to numbers, dense vectors are designed to represent the semantic meaning of text. The primary benefit of using dense vector embeddings is the ability to perform semantic search. Instead of searching for direct word or syntax matches, you can search for text passages that align with the meaning of your query, even if the passages don't use the same phrasing.

The embedding vectors are normalized, so you can use cosine similarity, dot product, or Euclidean distance to get the same similarity rankings.

*   To learn more about embeddings, see the [embeddings APIs overview](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings).
*   To learn about text embedding models, see [Text embeddings](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings).
*   For information about which languages each embeddings model supports, see [Supported text languages](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api#supported_text_languages).

![Questions and their answers aren't semantically similar](https://cloud.google.com/static/vertex-ai/generative-ai/docs/embeddings/images/embedding_flow.png)

**Figure 1.** Get Text Embedding.

Before you begin
----------------

*   In the Google Cloud console, on the project selector page, select or create a Google Cloud project.
    
    [Go to project selector](https://console.cloud.google.com/projectselector2/home/dashboard)
    
*   Enable the Vertex AI API.
    
    [Enable the API](https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com)
    2.  [Choose a task type](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/task-types) for your embeddings job.

Supported models
----------------

You can get text embeddings by using the following models:

Model name

Description

Output Dimensions

Max sequence length

Supported text languages

`gemini-embedding-001`

State-of-the-art performance across English, multilingual and code tasks. It unifies the previously specialized models like `text-embedding-005` and `text-multilingual-embedding-002` and achieves better performance in their respective domains. Read our [Tech Report](https://deepmind.google/research/publications/157741/) for more detail.

up to 3072

2048 tokens

[Supported text languages](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api#supported_text_languages)

`text-embedding-005`

Specialized in English and code tasks.

up to 768

2048 tokens

English

`text-multilingual-embedding-002`

Specialized in multilingual tasks.

up to 768

2048 tokens

[Supported text languages](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api#supported_text_languages)

For superior embedding quality, `gemini-embedding-001` is our large model designed to provide the highest performance. Note that `gemini-embedding-001` supports one instance per request.

Get text embeddings for a snippet of text
-----------------------------------------

You can get text embeddings for a snippet of text by using the Vertex AI API or the Vertex AI SDK for Python.

### API limits

For each request, you're limited to 250 input texts for non-Gemini models, and a single input text for Gemini Embedding models. The API has a maximum input token limit of 20,000. Inputs exceeding this limit result in a 400 error. Each individual input text is further limited to 2048 tokens; any excess is silently truncated. You can also disable silent truncation by setting `autoTruncate` to `false`.

For more information, see [Text embedding limits](https://cloud.google.com/vertex-ai/docs/quotas#text-embedding-limits).

### Choose an embedding dimension

All models produce a full-length embedding vector by default. For `gemini-embedding-001`, this vector has 3072 dimensions, and other models produce 768-dimensional vectors. However, by using the `output_dimensionality` parameter, users can control the size of the output embedding vector. Selecting a smaller output dimensionality can save storage space and increase computational efficiency for downstream applications, while sacrificing little in terms of quality.

The following examples use the `gemini-embedding-001` model.

#### Install

pip install --upgrade google-genai

To learn more, see the [SDK reference documentation](https://googleapis.github.io/python-genai/).

Set environment variables to use the Gen AI SDK with Vertex AI:

\# Replace the \`GOOGLE\_CLOUD\_PROJECT\` and \`GOOGLE\_CLOUD\_LOCATION\` values
\# with appropriate values for your project.
export GOOGLE\_CLOUD\_PROJECT\=GOOGLE\_CLOUD\_PROJECT
export GOOGLE\_CLOUD\_LOCATION\=global
export GOOGLE\_GENAI\_USE\_VERTEXAI\=True

Add an embedding to a vector database
-------------------------------------

After you've generated your embedding you can add embeddings to a vector database, like Vector Search. This enables low-latency retrieval, and is critical as the size of your data increases.

To learn more about Vector Search, see [Overview of Vector Search](https://cloud.google.com/vertex-ai/docs/vector-search/overview).

What's next
-----------

*   To learn more about rate limits, see [Generative AI on Vertex AI rate limits](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas).
*   To get batch predictions for embeddings, see [Get batch text embeddings predictions](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/batch-prediction-genai-embeddings)
*   To learn more about multimodal embeddings, see [Get multimodal embeddings](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)
*   To tune an embedding, see [Tune text embeddings](https://cloud.google.com/vertex-ai/generative-ai/docs/models/tune-embeddings)
*   To learn more about the research behind `text-embedding-005` and `text-multilingual-embedding-002`, see the research paper [Gecko: Versatile Text Embeddings Distilled from Large Language Models](https://arxiv.org/abs/2403.20327).